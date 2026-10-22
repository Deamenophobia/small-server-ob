import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createConfig, loadConfig, publicConfig } from '../lib/config.mjs';
import { createChecker, metricStatus } from '../lib/checks.mjs';
import { createApp } from '../lib/app.mjs';
import { createDemoApp } from '../lib/demo/app.mjs';
import { effectiveStatus } from '../lib/model.mjs';

test('configuration rejects unknown or unsafe values and merges defaults without mutation', async () => {
  const config = createConfig({ thresholds: { cpu: 70 }, monitoring: { concurrency: 2 } });
  assert.equal(config.thresholds.cpu, 70);
  assert.equal(config.thresholds.memory, 85);
  assert.equal(createConfig().thresholds.cpu, 90);
  for (const input of [
    { host: '0.0.0.0' },
    { thresholds: { cpU: 70 } },
    { monitoring: { concurrency: 0 } },
    { ui: { refreshMs: 10 } },
    { billing: { cacheHours: 0 } },
    { port: '4310' },
    { monitoring: { historyLimit: 10 } },
  ])
    assert.throws(() => createConfig(input));
  assert.equal(publicConfig(config).dataDirectory, undefined);
  assert.equal(metricStatus({ cpu: 71, memory: 20, disk: 10 }, config.thresholds), 'warning');
  assert.equal(
    effectiveStatus(
      { enabled: true, latest: { at: '2026-10-22T00:00:00Z', status: 'healthy' } },
      30,
      Date.parse('2026-10-22T00:01:00Z'),
      { ...config.thresholds, staleMultiplier: 1, staleMinimumMs: 1000 },
    ),
    'stale',
  );
});

test('config file paths and environment precedence are deterministic', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lookout-config-'));
  try {
    await writeFile(
      join(directory, 'custom.json'),
      JSON.stringify({ port: 4320, dataDirectory: './registry', monitoring: { timeoutMs: 6000 } }),
    );
    const config = await loadConfig({ cwd: directory, env: { LOOKOUT_CONFIG: 'custom.json', PORT: '4321' } });
    assert.equal(config.port, 4321);
    assert.equal(config.dataDirectory, join(directory, 'registry'));
    assert.equal(config.monitoring.timeoutMs, 6000);
    const overridden = await loadConfig({
      cwd: directory,
      env: { LOOKOUT_CONFIG: 'custom.json', LOOKOUT_DATA_DIR: './other' },
    });
    assert.equal(overridden.dataDirectory, join(directory, 'other'));
    await assert.rejects(loadConfig({ cwd: directory, env: { LOOKOUT_CONFIG: 'missing.json' } }));
    await writeFile(join(directory, 'custom.json'), '{broken');
    await assert.rejects(loadConfig({ cwd: directory, env: { LOOKOUT_CONFIG: 'custom.json' } }));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('configured concurrency, retention, defaults and capacity are applied end to end', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lookout-limits-'));
  let active = 0,
    peak = 0;
  const config = createConfig({
    monitoring: { concurrency: 1, historyLimit: 2, maxServers: 2, timeoutMs: 6000, intervalSeconds: 60 },
    ui: { historyVisible: 2 },
  });
  const checker = createChecker({
    config,
    adapters: {
      tcp: async (check, passedConfig) => {
        assert.equal(check.timeoutMs, 6000);
        assert.equal(passedConfig, config);
        peak = Math.max(peak, ++active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return { status: 'healthy', latencyMs: 1, message: 'Test adapter' };
      },
    },
  });
  const app = await createApp({
    config,
    checker,
    dataDirectory: directory,
    schedule: false,
    billingOptions: { env: {} },
  });
  try {
    const base = `http://127.0.0.1:${await app.start(0)}`;
    const token = (await (await fetch(base + '/api/session')).json()).token;
    const add = () =>
      fetch(base + '/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lookout-Token': token },
        body: JSON.stringify({ name: 'Example', check: { type: 'tcp', host: 'example.test', port: 80 } }),
      });
    assert.equal((await add()).status, 201);
    assert.equal((await add()).status, 201);
    assert.equal((await add()).status, 400);
    for (let round = 0; round < 3; round++) await app.collect();
    const state = await (await fetch(base + '/api/state')).json();
    assert.equal(peak, 1);
    assert.equal(state.servers[0].history.length, 2);
    assert.equal(state.settings.intervalSeconds, 60);
    assert.equal(state.config.historyVisible, 2);
    assert.equal((await fetch(base + '/js/features/fleet/cards.js')).status, 200);
    assert.equal((await fetch(base + '/styles/fleet.css')).status, 200);
    for (const path of [
      '/lib/config.mjs',
      '/data/registry.json',
      '/.env',
      '/docs/costs-and-billing.md',
      '/public/../server.mjs',
    ])
      assert.equal((await fetch(base + path)).status, 404);
    assert.equal(JSON.parse(await readFile(join(directory, 'registry.json'), 'utf8')).version, 1);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('demo ignores private registry and billing environment, checks stay synthetic, restart resets edits', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lookout-demo-private-'));
  const file = join(directory, 'registry.json');
  await writeFile(file, 'private-canary-do-not-read-or-change');
  const original = {
    LOOKOUT_DATA_DIR: process.env.LOOKOUT_DATA_DIR,
    DIGITALOCEAN_TOKEN: process.env.DIGITALOCEAN_TOKEN,
    LOOKOUT_AWS_BILLING: process.env.LOOKOUT_AWS_BILLING,
  };
  Object.assign(process.env, {
    LOOKOUT_DATA_DIR: directory,
    DIGITALOCEAN_TOKEN: 'canary-secret',
    LOOKOUT_AWS_BILLING: '1',
  });
  let app;
  try {
    app = await createDemoApp();
    const base = `http://127.0.0.1:${await app.start(0)}`;
    const token = (await (await fetch(base + '/api/session')).json()).token;
    const post = (path, data) =>
      fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Lookout-Token': token },
        body: JSON.stringify(data),
      });
    const state = await (await fetch(base + '/api/state')).json();
    assert.equal(state.demo, true);
    assert.equal(state.servers.length, 4);
    assert.equal(state.billing.providers.aws.enabled, false);
    assert.equal(state.billing.providers.digitalocean.enabled, false);
    assert.ok(!JSON.stringify(state).includes('canary'));
    assert.ok(!JSON.stringify(state).includes(directory));
    await post('/api/servers', {
      name: 'Demo edit',
      check: { type: 'ssh', alias: 'never-connect-to-this-alias' },
    });
    const checked = await (await post('/api/check', {})).json();
    assert.equal(checked.servers.length, 5);
    assert.match(checked.servers.at(-1).latest.message, /Synthetic/);
    assert.equal((await (await post('/api/billing/refresh', {})).json()).providers.aws.data, null);
    assert.equal(await readFile(file, 'utf8'), 'private-canary-do-not-read-or-change');
    await app.close();
    app = await createDemoApp();
    await app.start(0);
    assert.equal(app.store.state.servers.length, 4);
  } finally {
    if (app) await app.close();
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
