import { createConfig } from '../config.mjs';
import { createFleet } from '../services/fleet.mjs';
import { createHttpServer } from '../http/server.mjs';
import { metricStatus } from '../checks/ssh.mjs';
import { createDemoRegistry, demoContainers } from './fixture.mjs';

/** No registry files, env loading, cloud clients, SSH processes, or outbound health requests. */
export async function createDemoApp() {
  const config = createConfig({ port: 4311 });
  const store = {
    state: createDemoRegistry(),
    directory: 'In-memory demo · discarded on exit',
    persist: async () => {},
  };
  const billing = {
    view: () => ({
      checking: false,
      cacheHours: 6,
      providers: Object.fromEntries(
        ['aws', 'digitalocean'].map((provider) => [
          provider,
          { enabled: false, status: 'not_configured', data: null, error: null },
        ]),
      ),
    }),
    async refresh() {
      return this.view();
    },
  };
  const checker = async (server) => {
    const metrics =
      server.check.type === 'ssh' ? server.latest?.metrics || { cpu: 22, memory: 38, disk: 27 } : null;
    return {
      at: new Date().toISOString(),
      status: metrics ? metricStatus(metrics, config.thresholds) : 'healthy',
      latencyMs: 120,
      ...(metrics ? { metrics } : {}),
      ...(server.check.type === 'ssh' && server.check.docker
        ? { docker: demoContainers(server.check.alias === 'demo-atlas') }
        : {}),
      message: 'Synthetic observation · no server connection',
    };
  };
  const fleet = createFleet({ store, checker, billing, config, schedule: true });
  const originalView = fleet.view;
  fleet.view = () => ({ ...originalView(), demo: true });
  const app = await createHttpServer({ fleet, billing });
  let closed = false;
  return {
    app,
    store,
    async start(port = 4311) {
      try {
        await new Promise((done, fail) => {
          app.once('error', fail);
          app.listen(port, '127.0.0.1', () => {
            app.off('error', fail);
            done();
          });
        });
      } catch (error) {
        await fleet.close();
        throw error;
      }
      fleet.start();
      return app.address().port;
    },
    async close() {
      if (closed) return;
      closed = true;
      await fleet.close();
      if (app.listening) await new Promise((done) => app.close(done));
    },
  };
}
