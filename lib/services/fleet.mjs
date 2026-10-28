import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  validateServer,
  validateSettings,
  validateCost,
  ValidationError,
  effectiveStatus,
} from '../model.mjs';
import { summarizeCosts, estimate } from '../costs.mjs';
import { publicConfig } from '../config.mjs';
import { RequestError } from '../http/errors.mjs';

/** Registry operations and the scheduler share this service; billing is never collected here. */
export function createFleet({ store, checker, billing, config, schedule }) {
  let running = null,
    timer,
    lastError = null;
  const limits = config.monitoring;
  const view = () => ({
    ...store.state,
    servers: store.state.servers.map((server) => ({
      ...server,
      costEstimate: estimate(server.cost),
      status: effectiveStatus(server, store.state.settings.intervalSeconds, Date.now(), config.thresholds),
    })),
    costs: summarizeCosts(store.state.servers),
    billing: billing.view(),
    config: publicConfig(config),
    checking: !!running,
    storageError: lastError,
    dataDirectory: store.directory,
    now: new Date().toISOString(),
  });
  async function save() {
    try {
      await store.persist();
      lastError = null;
    } catch {
      lastError = 'Changes could not be saved to disk. Check available space and folder permissions.';
      throw new Error(lastError);
    }
  }
  function find(id) {
    const server = store.state.servers.find((server) => server.id === id);
    if (!server) throw new RequestError(404, 'Server not found.');
    return server;
  }
  function capacity(count) {
    if (store.state.servers.length + count > limits.maxServers)
      throw new ValidationError(`The local registry supports up to ${limits.maxServers} servers.`);
  }
  async function collect(id) {
    if (running) return running;
    const selected = store.state.servers.filter((server) => server.enabled && (!id || server.id === id));
    const work = async () => {
      let index = 0;
      await Promise.all(
        Array.from({ length: Math.min(limits.concurrency, selected.length) }, async () => {
          while (index < selected.length) {
            const server = selected[index++];
            const result = await checker(server);
            // Editing/deleting invalidates a result already in flight.
            if (!store.state.servers.includes(server) || !server.enabled) continue;
            server.latest = result;
            server.history = [...server.history, result].slice(-limits.historyLimit);
          }
        }),
      );
      if (selected.length) await save();
    };
    running = work().finally(() => {
      running = null;
    });
    return running;
  }
  function reschedule() {
    clearInterval(timer);
    if (schedule)
      timer = setInterval(() => collect().catch(() => {}), store.state.settings.intervalSeconds * 1000);
  }
  return {
    view,
    collect,
    error: () => lastError,
    start() {
      reschedule();
      if (schedule) collect().catch(() => {});
    },
    async close() {
      clearInterval(timer);
      if (running) await running.catch(() => {});
    },
    async check(id) {
      if (id) find(id);
      if (running) throw new RequestError(409, 'Checks are already running. Please wait for them to finish.');
      await collect(id);
      return view();
    },
    async add(input) {
      capacity(1);
      const server = { ...validateServer(input, config), id: randomUUID(), history: [], latest: null };
      store.state.servers.push(server);
      await save();
      return server;
    },
    async update(id, input) {
      const old = find(id),
        validated = validateServer(input, config);
      const sameTarget = isDeepStrictEqual(validated.check, old.check);
      const server = {
        ...validated,
        id,
        history: sameTarget ? old.history : [],
        latest: sameTarget ? old.latest : null,
      };
      store.state.servers[store.state.servers.indexOf(old)] = server;
      await save();
      return server;
    },
    async remove(id) {
      const server = find(id);
      store.state.servers.splice(store.state.servers.indexOf(server), 1);
      await save();
      return { ok: true };
    },
    async setCost(id, input) {
      find(id).cost = validateCost(input);
      await save();
      return view();
    },
    async setSettings(input) {
      store.state.settings = validateSettings(input);
      await save();
      reschedule();
      return view();
    },
    exportRegistry() {
      return {
        version: 1,
        settings: store.state.settings,
        servers: store.state.servers.map(({ id, latest, history, ...configuration }) => configuration),
      };
    },
    async importRegistry(input) {
      if (input?.version !== 1 || !Array.isArray(input.servers))
        throw new ValidationError('Use a valid Small Server OB registry export.');
      capacity(input.servers.length);
      const servers = input.servers.map((server) => ({
        ...validateServer(server, config),
        id: randomUUID(),
        history: [],
        latest: null,
      }));
      store.state.servers.push(...servers);
      await save();
      return { added: servers.length };
    },
  };
}
