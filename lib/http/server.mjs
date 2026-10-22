import http from 'node:http';
import { join } from 'node:path';
import { projectRoot } from '../config.mjs';
import { ValidationError } from '../model.mjs';
import { createLocalSecurity } from './security.mjs';
import { createAssets } from './assets.mjs';
import { createRoutes } from './routes.mjs';
import { RequestError } from './errors.mjs';
import { json, readJson } from './response.mjs';

export async function createHttpServer({ fleet, billing }) {
  const security = createLocalSecurity();
  const assets = await createAssets(join(projectRoot, 'public'));
  const routes = createRoutes({ fleet, billing, token: security.token });
  const server = http.createServer(async (request, response) => {
    try {
      security.verify(request, response, server.address()?.port);
      const path = new URL(request.url, `http://${request.headers.host}`).pathname;
      for (const route of routes) {
        if (request.method !== route.method) continue;
        const match = path.match(route.pattern);
        if (!match) continue;
        const result = await route.handle({ params: match.slice(1), body: () => readJson(request) });
        return json(response, route.status, result);
      }
      if (request.method === 'GET' && (await assets(path, response))) return;
      throw new RequestError(404, 'Not found.');
    } catch (error) {
      if (response.headersSent) return;
      const status =
        error instanceof ValidationError ? 400 : error instanceof RequestError ? error.status : 500;
      json(response, status, {
        error: status === 500 ? fleet.error() || 'The request could not be completed.' : error.message,
      });
    }
  });
  return server;
}
