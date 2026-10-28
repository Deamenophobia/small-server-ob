import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, access, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { projectRoot } from '../lib/config.mjs';

const linuxOnly = { skip: process.platform !== 'linux', timeout: 20000 };

async function availablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

function launch(script, cwd, env) {
  const child = spawn(script, [], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    output += chunk;
  });
  const closed = new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Launcher did not become ready: ${output}`)), 10000);
    child.stdout.on('data', () => {
      if (output.includes('Small Server OB is ready at')) {
        clearTimeout(timer);
        resolve();
      }
    });
    closed.then(() => {
      clearTimeout(timer);
      reject(new Error(`Launcher exited: ${output}`));
    });
  });
  return { child, closed, ready };
}

async function stop(instance, signal) {
  if (instance.child.exitCode !== null) return instance.closed;
  instance.child.kill(signal);
  const timer = setTimeout(() => instance.child.kill('SIGKILL'), 3000);
  try {
    return await instance.closed;
  } finally {
    clearTimeout(timer);
  }
}

test(
  'Linux launcher starts from another directory, persists data, and handles SIGTERM/SIGINT',
  linuxOnly,
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'lookout linux '));
    let running;
    t.after(async () => {
      if (running) await stop(running, 'SIGTERM');
      await rm(directory, { recursive: true, force: true });
    });
    const application = join(directory, 'application with spaces');
    const data = join(directory, 'private registry');
    await mkdir(application);
    // Copy only application files; never copy the developer's config, registry, or credentials.
    for (const file of ['start.sh', 'server.mjs', 'package.json', 'lib', 'public'])
      await cp(join(projectRoot, file), join(application, file), { recursive: true });
    const script = join(application, 'start.sh');
    assert.ok((await stat(script)).mode & 0o111, 'start.sh must be executable in the Git checkout');
    const port = await availablePort();
    const base = `http://127.0.0.1:${port}`;
    // An allowlist isolates the child from local cloud credentials and configuration overrides.
    const env = {
      PATH: process.env.PATH,
      HOME: directory,
      PORT: String(port),
      LOOKOUT_DATA_DIR: data,
      LOOKOUT_AWS_BILLING: '0',
    };
    running = launch(script, directory, env);
    await running.ready;
    assert.match(await (await fetch(base)).text(), /Small Server OB/);
    const initial = await (await fetch(`${base}/api/state`)).json();
    assert.equal(initial.dataDirectory, data);
    assert.equal(initial.billing.providers.aws.enabled, false);
    assert.equal(initial.billing.providers.digitalocean.enabled, false);
    const { token } = await (await fetch(`${base}/api/session`)).json();
    const response = await fetch(`${base}/api/servers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Lookout-Token': token },
      body: JSON.stringify({
        name: 'Linux demo',
        enabled: false,
        notes: 'Saved on Linux',
        check: { type: 'tcp', host: 'example.test', port: 80 },
      }),
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await stop(running, 'SIGTERM'), { code: 0, signal: null });
    await assert.rejects(access(join(data, 'registry.lock')), { code: 'ENOENT' });
    assert.equal(
      JSON.parse(await readFile(join(data, 'registry.json'), 'utf8')).servers[0].name,
      'Linux demo',
    );

    running = launch(script, directory, env);
    await running.ready;
    const restored = await (await fetch(`${base}/api/state`)).json();
    assert.equal(restored.servers[0].notes, 'Saved on Linux');
    assert.equal(restored.servers[0].status, 'paused');
    assert.deepEqual(await stop(running, 'SIGINT'), { code: 0, signal: null });
    await assert.rejects(access(join(data, 'registry.lock')), { code: 'ENOENT' });
  },
);

test(
  'Linux launcher explains missing and unsupported Node.js without starting the app',
  linuxOnly,
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'lookout-node-check-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const script = join(projectRoot, 'start.sh');
    const options = { env: { PATH: directory }, encoding: 'utf8', timeout: 3000 };
    const missing = spawnSync('/bin/sh', [script], options);
    assert.equal(missing.status, 127);
    assert.match(missing.stderr, /Node\.js 22 or newer is required/);
    // The stub represents a Node runtime that rejects the minimum-version check.
    await writeFile(join(directory, 'node'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const old = spawnSync('/bin/sh', [script], options);
    assert.equal(old.status, 1);
    assert.match(old.stderr, /Upgrade Node\.js/);
  },
);
