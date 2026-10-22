import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.mjs';
import { createStore } from '../lib/store.mjs';
import { validateServer, effectiveStatus } from '../lib/model.mjs';
import { runCheck, sshArgs, parseMetrics, metricStatus } from '../lib/checks.mjs';

const config = (url = 'http://127.0.0.1:1/health') => ({
  name: 'Test API',
  provider: 'Other',
  region: 'Local',
  notes: 'Integration test',
  check: { type: 'http', url, timeoutMs: 2000 },
  links: [{ label: 'Console', url: 'https://example.com/' }],
});
const observation = () => ({
  at: new Date().toISOString(),
  status: 'healthy',
  latencyMs: 12,
  message: 'HTTP 200',
});
async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'lookout-test-'));
  const instance = await createApp({ dataDirectory: directory, schedule: false, ...options });
  const port = await instance.start(0);
  const base = `http://127.0.0.1:${port}`;
  const token = (await (await fetch(`${base}/api/session`)).json()).token;
  t.after(async () => {
    await instance.close();
    await rm(directory, { recursive: true, force: true });
  });
  const request = async (path, method = 'GET', data) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'X-Lookout-Token': token, 'Content-Type': 'application/json' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return { instance, directory, base, port, token, request };
}

test('registry CRUD, check history, settings and export survive restart', async (t) => {
  const { instance, directory, request } = await fixture(t, { checker: async () => observation() });
  const added = await request('/api/servers', 'POST', config());
  assert.equal(added.status, 201);
  const id = added.body.id;
  assert.equal((await request('/api/check', 'POST', { id })).status, 200);
  let state = (await request('/api/state')).body;
  assert.equal(state.servers[0].status, 'healthy');
  assert.equal(state.servers[0].history.length, 1);
  const edited = { ...config(), name: 'Renamed', notes: 'Saved note', enabled: false };
  // Imported/adapted records may have identical check fields in a different insertion order.
  instance.store.state.servers[0].check = Object.fromEntries(
    Object.entries(instance.store.state.servers[0].check).reverse(),
  );
  assert.equal((await request(`/api/servers/${id}`, 'PUT', edited)).status, 200);
  await request('/api/settings', 'PUT', { intervalSeconds: 60 });
  state = JSON.parse(await readFile(join(directory, 'registry.json'), 'utf8'));
  assert.equal(state.servers[0].notes, 'Saved note');
  assert.equal(state.settings.intervalSeconds, 60);
  const exported = (await request('/api/export')).body;
  assert.equal(exported.servers[0].history, undefined);
  assert.equal(exported.servers[0].id, undefined);
  const secondDirectory = await mkdtemp(join(tmpdir(), 'lookout-restart-'));
  try {
    await writeFile(join(secondDirectory, 'registry.json'), JSON.stringify(state));
    const reopened = await createStore(secondDirectory);
    assert.equal(reopened.state.servers[0].name, 'Renamed');
    assert.equal(reopened.state.servers[0].history.length, 1);
    await reopened.close();
  } finally {
    await rm(secondDirectory, { recursive: true, force: true });
  }
  const paused = (await request('/api/state')).body.servers[0];
  assert.equal(paused.status, 'paused');
  const imported = await request('/api/import', 'POST', exported);
  assert.equal(imported.body.added, 1);
  assert.equal((await request(`/api/servers/${id}`, 'DELETE')).status, 200);
  assert.equal(instance.store.state.servers.length, 1);
});

test('local API rejects cross-origin access, forged Host, missing tokens and unsafe configuration', async (t) => {
  const { base, port, request } = await fixture(t);
  assert.equal(
    (await fetch(`${base}/api/state`, { headers: { Origin: 'https://evil.example' } })).status,
    403,
  );
  assert.equal((await fetch(`${base}/api/servers`, { method: 'POST', body: '{}' })).status, 403);
  assert.equal(
    (await fetch(`${base}/api/session`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status,
    403,
  );
  const forged = await new Promise((resolve) =>
    http.get(
      { hostname: '127.0.0.1', port, path: '/api/state', headers: { Host: 'attacker.example' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    ),
  );
  assert.equal(forged, 403);
  for (const bad of [
    { ...config(), check: { type: 'ssh', alias: '-oProxyCommand=malicious' } },
    { ...config(), check: { type: 'ssh', alias: 'host; touch a-file' } },
    { ...config(), check: { type: 'http', url: 'file:///etc/passwd' } },
    { ...config(), check: { type: 'http', url: 'https://user:password@example.com/' } },
    { ...config(), links: [{ label: 'XSS', url: 'javascript:alert(1)' }] },
    { ...config(), check: { type: 'tcp', host: '127.0.0.1', port: 65536 } },
  ])
    assert.equal((await request('/api/servers', 'POST', bad)).status, 400);
  assert.equal((await request('/api/settings', 'PUT', { intervalSeconds: 0 })).status, 400);
  const invalidImport = await request('/api/import', 'POST', {
    version: 1,
    servers: [config(), { ...config(), name: '' }],
  });
  assert.equal(invalidImport.status, 400);
  assert.equal((await request('/api/state')).body.servers.length, 0);
});

test('real HTTP and TCP checks report failures, redirects and timeouts without following redirects', async (t) => {
  let redirected = false;
  const endpoint = http.createServer((req, res) => {
    if (req.url === '/slow') return;
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/followed' });
      return res.end();
    }
    if (req.url === '/followed') redirected = true;
    res.writeHead(req.url === '/fail' ? 503 : 200);
    res.end('health');
  });
  await new Promise((done) => endpoint.listen(0, '127.0.0.1', done));
  t.after(() => new Promise((done) => endpoint.close(done)));
  const port = endpoint.address().port,
    base = `http://127.0.0.1:${port}`;
  assert.equal((await runCheck(validateServer(config(base)))).status, 'healthy');
  assert.equal((await runCheck(validateServer(config(`${base}/fail`)))).status, 'down');
  assert.equal((await runCheck(validateServer(config(`${base}/redirect`)))).status, 'warning');
  assert.equal(redirected, false);
  const timeout = await runCheck(validateServer(config(`${base}/slow`)));
  assert.equal(timeout.status, 'down');
  assert.match(timeout.message, /timed out/);
  const tcp = await runCheck(
    validateServer({ ...config(), check: { type: 'tcp', host: '127.0.0.1', port } }),
  );
  assert.equal(tcp.status, 'healthy');
  const closed = net.createServer();
  await new Promise((done) => closed.listen(0, '127.0.0.1', done));
  const closedPort = closed.address().port;
  await new Promise((done) => closed.close(done));
  assert.equal(
    (
      await runCheck(
        validateServer({ ...config(), check: { type: 'tcp', host: '127.0.0.1', port: closedPort } }),
      )
    ).status,
    'down',
  );
});

test('in-flight observations cannot overwrite edited or removed configurations; history is bounded', async (t) => {
  let release, entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let block = true;
  const { instance, request } = await fixture(t, {
    checker: async () => {
      if (block) {
        entered();
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      return observation();
    },
  });
  const { body: server } = await request('/api/servers', 'POST', config());
  const collecting = instance.collect(server.id);
  await started;
  await request(`/api/servers/${server.id}`, 'PUT', {
    ...config('http://127.0.0.1:2/'),
    name: 'Different host',
  });
  release();
  await collecting;
  block = false;
  assert.equal(instance.store.state.servers[0].latest, null);
  for (let i = 0; i < 63; i++) await instance.collect(server.id);
  assert.equal(instance.store.state.servers[0].history.length, 60);
});

test('SSH arguments enforce noninteractive verified connections; malformed metrics never pass', () => {
  const args = sshArgs({ alias: 'production-api' });
  for (const flag of [
    'BatchMode=yes',
    'StrictHostKeyChecking=yes',
    'ClearAllForwardings=yes',
    'PermitLocalCommand=no',
  ])
    assert.ok(args.includes(flag));
  assert.deepEqual(args.slice(-3), ['production-api', 'python3', '-']);
  assert.throws(() => sshArgs({ alias: '-Fmalicious' }));
  assert.throws(() => parseMetrics('{"cpu": 4, "memory": "12", "disk": 10}'));
  assert.throws(() => parseMetrics('{"cpu": -1, "memory": 12, "disk": 10}'));
  assert.equal(metricStatus(parseMetrics('{"cpu": 4, "memory": 12, "disk": 90}')), 'warning');
  assert.equal(metricStatus({ cpu: 4, memory: 12, disk: 10 }), 'healthy');
  assert.equal(
    effectiveStatus({ enabled: true, latest: { ...observation(), at: '2020-01-01T00:00:00.000Z' } }, 30),
    'stale',
  );
  assert.equal(effectiveStatus({ enabled: false, latest: observation() }, 30), 'paused');
});

test('corrupt registries are preserved and concurrent writers are rejected', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lookout-corrupt-'));
  try {
    const file = join(directory, 'registry.json');
    await writeFile(file, '{corrupt');
    await assert.rejects(createStore(directory), /existing data was preserved/);
    assert.equal(await readFile(file, 'utf8'), '{corrupt');
    await writeFile(file, JSON.stringify({ version: 1, settings: { intervalSeconds: 30 }, servers: [] }));
    const store = await createStore(directory);
    await assert.rejects(createStore(directory), /already in use/);
    await store.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
