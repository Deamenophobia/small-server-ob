import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DOCKER_COLLECTOR, parseDocker } from '../lib/checks/docker.mjs';
import { parseSshObservation, sshCollector, sshCheck } from '../lib/checks/ssh.mjs';
import { validateServer } from '../lib/model.mjs';
import { createStore } from '../lib/store.mjs';
import { createFleet } from '../lib/services/fleet.mjs';
import { createConfig } from '../lib/config.mjs';
import { containerMarkup } from '../public/js/features/fleet/containers.js';

const item = {
  id: 'a'.repeat(64),
  name: 'demo-api',
  image: 'example/api:1',
  state: 'running',
  status: 'Up 2 hours (healthy)',
};
const inventory = (containers = [item]) => ({ status: 'ok', containers, truncated: false });
const host = JSON.stringify({ cpu: 12, memory: 30, disk: 25 });

test('SSH process timeouts and output limits preserve the flushed host reading', async () => {
  for (const kind of ['timeout', 'invalid']) {
    const spawnSsh = () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => queueMicrotask(() => child.emit('close', null));
      child.stdin.on('finish', () => {
        child.stdout.write(host + '\n');
        if (kind === 'invalid') child.stdout.write('x'.repeat(131072));
      });
      return child;
    };
    const result = await sshCheck(
      { alias: 'example', docker: true, timeoutMs: 20 },
      createConfig(),
      spawnSsh,
    );
    assert.equal(result.status, 'healthy');
    assert.equal(result.metrics.cpu, 12);
    assert.equal(result.docker.status, kind);
  }
});

test('Docker is opt-in; validation and collector keep legacy SSH checks unchanged', () => {
  const input = { name: 'Example', check: { type: 'ssh', alias: 'example' } };
  assert.equal(validateServer(input).check.docker, undefined);
  assert.equal(
    validateServer({ ...input, check: { ...input.check, docker: false } }).check.docker,
    undefined,
  );
  assert.equal(validateServer({ ...input, check: { ...input.check, docker: true } }).check.docker, true);
  assert.throws(() => validateServer({ ...input, check: { ...input.check, docker: 'yes' } }));
  assert.ok(!sshCollector(input.check).includes('subprocess'));
  assert.ok(sshCollector({ ...input.check, docker: true }).includes('unix:///var/run/docker.sock'));
});

test('inventory distinguishes lifecycle and health; malformed and oversized results stay unknown', () => {
  const parsed = parseDocker(
    JSON.stringify(
      inventory([
        item,
        { ...item, id: 'b'.repeat(64), status: 'Up 1 minute (health: starting)' },
        { ...item, id: 'c'.repeat(64), status: 'Up 2 hours' },
        { ...item, id: 'd'.repeat(64), state: 'exited', status: 'Exited (0) 1 hour ago' },
        { ...item, id: 'e'.repeat(64), status: 'Up 1 minute (unhealthy)', env: 'private-canary' },
      ]),
    ),
  );
  assert.deepEqual(
    parsed.containers.map((c) => c.health),
    ['healthy', 'starting', 'none', 'not_running', 'unhealthy'],
  );
  assert.ok(!JSON.stringify(parsed).includes('private-canary'));
  for (const bad of [
    'bad json',
    'null',
    JSON.stringify(inventory([item, item])),
    JSON.stringify(inventory(Array(101).fill(item))),
    JSON.stringify(inventory([{ ...item, name: 'x'.repeat(129) }])),
  ])
    assert.equal(parseDocker(bad).status, 'invalid');
  assert.deepEqual(parseDocker(JSON.stringify(inventory([]))), inventory([]));
});

test('Docker errors and interrupted collection preserve a valid host observation', () => {
  for (const status of ['not_installed', 'permission_denied', 'unavailable', 'timeout', 'invalid']) {
    const result = parseSshObservation(host + '\n' + JSON.stringify({ status }), { docker: true });
    assert.equal(result.status, 'healthy');
    assert.equal(result.metrics.cpu, 12);
    assert.equal(result.docker.status, status);
  }
  assert.equal(parseSshObservation(host + '\n', { docker: true }, undefined, true).docker.status, 'timeout');
  assert.equal(parseSshObservation(host, { docker: true }).docker.status, 'invalid');
  assert.equal(parseSshObservation(host, {}).docker, undefined);
  assert.throws(() => parseSshObservation('login banner\n' + host, { docker: true }));
});

test('container panel escapes remote strings and labels stale, absent-health and empty observations', () => {
  const docker = parseDocker(
    JSON.stringify(inventory([{ ...item, name: '<img src=x onerror=alert(1)>', status: 'Up 1 hour' }])),
  );
  const server = { check: { type: 'ssh', docker: true }, status: 'stale', latest: { docker } };
  const markup = containerMarkup(server);
  assert.match(markup, /&lt;img/);
  assert.ok(!markup.includes('<img'));
  assert.match(markup, /No health check configured/);
  assert.match(markup, /Last observation/);
  assert.match(containerMarkup({ ...server, latest: { docker: inventory([]) } }), /No containers found/);
  assert.match(
    containerMarkup({ ...server, latest: { docker: { status: 'permission_denied' } } }),
    /Permission denied/,
  );
  assert.equal(containerMarkup({ ...server, check: { type: 'http' } }), '');
});

test('Docker option and latest snapshot survive restart and export/import without bloating history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'server-ob-docker-'));
  let store;
  const config = createConfig();
  const observation = {
    ...parseSshObservation(host + '\n' + JSON.stringify(inventory()), { docker: true }),
    at: new Date().toISOString(),
    latencyMs: 10,
  };
  try {
    store = await createStore(directory);
    const fleet = createFleet({
      store,
      config,
      schedule: false,
      checker: async () => observation,
      billing: { view: () => ({}) },
    });
    const server = await fleet.add({
      name: 'Example',
      check: { type: 'ssh', alias: 'example', docker: true },
    });
    await fleet.collect();
    assert.equal(server.latest.docker.containers.length, 1);
    assert.equal(server.history[0].docker, undefined);
    const exported = fleet.exportRegistry();
    assert.equal(exported.servers[0].check.docker, true);
    assert.equal(exported.servers[0].latest, undefined);
    await fleet.importRegistry(exported);
    assert.equal(store.state.servers[1].check.docker, true);
    await store.close();
    store = await createStore(directory);
    assert.equal(store.state.servers[0].latest.docker.containers[0].health, 'healthy');
    assert.equal(store.state.servers[0].check.docker, true);
  } finally {
    if (store) await store.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('fixed remote Python collector handles Docker responses without contacting a daemon', (t) => {
  const python = ['python3', 'python'].find(
    (name) => spawnSync(name, ['--version'], { windowsHide: true }).status === 0,
  );
  if (!python) return t.skip('Python 3 is needed to exercise the remote collector locally.');
  const script = String.raw`
import json, sys, subprocess, types
data = json.load(sys.stdin)
def fake_run(args, **kwargs):
    assert args[:4] == ['docker', '--host', 'unix:///var/run/docker.sock', 'ps']
    assert args[args.index('--last') + 1] == '101'
    assert kwargs['timeout'] == 2
    assert 'shell' not in kwargs
    if data['case'] == 'missing': raise FileNotFoundError()
    if data['case'] == 'timeout': raise subprocess.TimeoutExpired(args, 2)
    if data['case'] == 'denied': return types.SimpleNamespace(returncode=1, stdout=b'', stderr=b'permission denied private-canary')
    if data['case'] == 'offline': return types.SimpleNamespace(returncode=1, stdout=b'', stderr=b'daemon unavailable private-canary')
    return types.SimpleNamespace(returncode=0, stdout=data['output'].encode(), stderr=b'')
subprocess.run = fake_run
exec(data['collector'])
`;
  for (const [scenario, expected] of [
    ['ok', 'ok'],
    ['missing', 'not_installed'],
    ['timeout', 'timeout'],
    ['denied', 'permission_denied'],
    ['offline', 'unavailable'],
    ['bad', 'invalid'],
  ]) {
    const output =
      scenario === 'bad'
        ? 'not json'
        : Array.from({ length: 101 }, (_, i) =>
            JSON.stringify({ ...item, id: i.toString(16).padStart(64, '0') }),
          ).join('\n');
    const result = spawnSync(python, ['-c', script], {
      input: JSON.stringify({ case: scenario, output, collector: DOCKER_COLLECTOR }),
      encoding: 'utf8',
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    const parsed = parseDocker(result.stdout);
    assert.equal(parsed.status, expected);
    assert.ok(!result.stdout.includes('private-canary'));
    if (scenario === 'ok') {
      assert.equal(parsed.containers.length, 100);
      assert.equal(parsed.truncated, true);
    }
  }
});
