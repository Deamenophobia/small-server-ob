import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const defaults = Object.freeze({
  port: 4310,
  dataDirectory: resolve(projectRoot, 'data'),
  monitoring: Object.freeze({
    intervalSeconds: 30,
    timeoutMs: 10000,
    concurrency: 4,
    historyLimit: 60,
    maxServers: 200,
  }),
  thresholds: Object.freeze({
    cpu: 90,
    memory: 85,
    disk: 85,
    latencyMs: 1500,
    staleMultiplier: 2.5,
    staleMinimumMs: 45000,
  }),
  billing: Object.freeze({ cacheHours: 6, retrySeconds: 60 }),
  ui: Object.freeze({ refreshMs: 5000, historyVisible: 28 }),
});

const ranges = {
  monitoring: {
    intervalSeconds: [10, 3600],
    timeoutMs: [2000, 30000],
    concurrency: [1, 16],
    historyLimit: [1, 1000],
    maxServers: [1, 2000],
  },
  thresholds: {
    cpu: [1, 100],
    memory: [1, 100],
    disk: [1, 100],
    latencyMs: [1, 60000],
    staleMultiplier: [1, 20],
    staleMinimumMs: [1000, 3600000],
  },
  billing: { cacheHours: [1, 168], retrySeconds: [60, 3600] },
  ui: { refreshMs: [1000, 60000], historyVisible: [1, 100] },
};
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
}
function keys(value, allowed, label) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new Error(`Unknown configuration key: ${label}${key}`);
}
function number(value, min, max, label, integer = true) {
  if (!Number.isFinite(value) || (integer && !Number.isInteger(value)) || value < min || value > max)
    throw new Error(`${label} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
}

/** Validate before starting any checks or opening the registry. No credentials belong here. */
export function createConfig(input = {}, baseDirectory = projectRoot) {
  object(input, 'Configuration');
  keys(input, Object.keys(defaults), '');
  const config = { ...defaults, ...input };
  number(config.port, 1, 65535, 'port');
  if (typeof config.dataDirectory !== 'string' || !config.dataDirectory.trim())
    throw new Error('dataDirectory must be a nonempty path.');
  config.dataDirectory = resolve(baseDirectory, config.dataDirectory);
  for (const [section, fields] of Object.entries(ranges)) {
    if (input[section] !== undefined) {
      object(input[section], section);
      keys(input[section], Object.keys(fields), `${section}.`);
    }
    config[section] = { ...defaults[section], ...input[section] };
    for (const [key, [min, max]] of Object.entries(fields))
      number(config[section][key], min, max, `${section}.${key}`, key !== 'staleMultiplier');
    Object.freeze(config[section]);
  }
  if (config.ui.historyVisible > config.monitoring.historyLimit)
    throw new Error('ui.historyVisible must not exceed monitoring.historyLimit.');
  return Object.freeze(config);
}

/** Environment overrides JSON; persisted workspace interval overrides the startup default. */
export async function loadConfig({ env = process.env, cwd = process.cwd() } = {}) {
  const file = resolve(cwd, env.LOOKOUT_CONFIG || resolve(projectRoot, 'lookout.config.json'));
  let input = {};
  try {
    input = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT' || env.LOOKOUT_CONFIG)
      throw new Error(`Cannot load Small Server OB configuration: ${error.message}`);
  }
  object(input, 'Configuration');
  if (env.PORT !== undefined) input.port = Number(env.PORT);
  if (env.LOOKOUT_DATA_DIR) input.dataDirectory = resolve(cwd, env.LOOKOUT_DATA_DIR);
  return createConfig(input, dirname(file));
}

/** An explicit allowlist prevents secrets and local filesystem paths reaching UI configuration. */
export function publicConfig(config) {
  return {
    thresholds: config.thresholds,
    timeoutMs: config.monitoring.timeoutMs,
    maxServers: config.monitoring.maxServers,
    ...config.ui,
  };
}
