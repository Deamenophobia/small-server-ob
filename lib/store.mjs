import { mkdir, readFile, writeFile, rename, copyFile, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateServer, validateSettings } from './model.mjs';
import { defaults } from './config.mjs';

export async function createStore(directory, config = defaults) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'registry.json');
  const lockPath = join(directory, 'registry.lock');
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    let alive = true;
    try {
      process.kill(pid, 0);
    } catch (e) {
      if (e.code === 'ESRCH') alive = false;
    }
    if (alive || !pid)
      throw new Error('This registry is already in use. Close the other Lookout process first.');
    await unlink(lockPath);
    lock = await open(lockPath, 'wx');
  }
  await lock.writeFile(String(process.pid));
  let state = { version: 1, settings: { intervalSeconds: config.monitoring.intervalSeconds }, servers: [] };
  try {
    const raw = JSON.parse(await readFile(file, 'utf8'));
    if (raw.version !== 1 || !Array.isArray(raw.servers) || raw.servers.length > config.monitoring.maxServers)
      throw new Error('Invalid registry format or configured server limit exceeded.');
    state.settings = validateSettings(raw.settings);
    const ids = new Set();
    state.servers = raw.servers.map((s) => {
      if (typeof s.id !== 'string' || !/^[a-f0-9-]{36}$/.test(s.id) || ids.has(s.id))
        throw new Error('Invalid or duplicate server ID.');
      ids.add(s.id);
      const history = (Array.isArray(s.history) ? s.history : [])
        .filter(validObservation)
        .slice(-config.monitoring.historyLimit);
      return {
        ...validateServer(s, config),
        id: s.id,
        history,
        latest: validObservation(s.latest) ? s.latest : null,
      };
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      await lock.close();
      await unlink(lockPath);
      throw new Error(`Registry could not be loaded; existing data was preserved. ${error.message}`);
    }
  }
  let writes = Promise.resolve();
  const persist = () => {
    const snapshot = JSON.stringify(state, null, 2) + '\n';
    const pending = writes.then(async () => {
      const temp = join(directory, `registry.${randomUUID()}.tmp`);
      const handle = await open(temp, 'wx', 0o600);
      try {
        await handle.writeFile(snapshot);
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await copyFile(file, `${file}.bak`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await rename(temp, file);
    });
    writes = pending.catch(() => {});
    return pending;
  };
  return {
    state,
    persist,
    directory,
    async close() {
      await writes;
      await lock.close();
      await unlink(lockPath);
    },
  };
}

function validObservation(value) {
  return (
    value &&
    ['healthy', 'warning', 'down', 'unknown'].includes(value.status) &&
    typeof value.at === 'string' &&
    Number.isFinite(Date.parse(value.at)) &&
    typeof value.message === 'string' &&
    value.message.length <= 1000 &&
    (value.latencyMs === null || (Number.isFinite(value.latencyMs) && value.latencyMs >= 0)) &&
    (value.metrics == null ||
      ['cpu', 'memory', 'disk'].every(
        (k) => Number.isFinite(value.metrics[k]) && value.metrics[k] >= 0 && value.metrics[k] <= 100,
      ))
  );
}
