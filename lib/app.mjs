import { resolve } from 'node:path';
import { createConfig } from './config.mjs';
import { createStore } from './store.mjs';
import { createChecker } from './checks.mjs';
import { createBilling } from './billing.mjs';
import { createFleet } from './services/fleet.mjs';
import { createHttpServer } from './http/server.mjs';

/** Composition root. Dependencies can be replaced by offline test/demo implementations. */
export async function createApp({
  config = createConfig(),
  dataDirectory = config.dataDirectory,
  checker,
  schedule = true,
  billingOptions,
} = {}) {
  config = createConfig(config);
  const store = await createStore(resolve(dataDirectory), config);
  let billing, fleet, app;
  try {
    billing = await createBilling(store.directory, { ...config.billing, ...billingOptions });
    fleet = createFleet({ store, checker: checker || createChecker({ config }), billing, config, schedule });
    app = await createHttpServer({ fleet, billing });
  } catch (error) {
    await store.close();
    throw error;
  }
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await fleet.close();
    await billing.close();
    if (app.listening) await new Promise((done) => app.close(done));
    await store.close();
  }
  return {
    app,
    store,
    collect: fleet.collect,
    async start(port = config.port) {
      try {
        await new Promise((done, fail) => {
          app.once('error', fail);
          app.listen(port, '127.0.0.1', () => {
            app.off('error', fail);
            done();
          });
        });
      } catch (error) {
        await close();
        throw error;
      }
      fleet.start();
      return app.address().port;
    },
    close,
  };
}
