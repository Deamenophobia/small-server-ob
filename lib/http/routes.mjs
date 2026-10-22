const id = '([a-f0-9-]{36})';

/** Routes translate HTTP into service calls; add endpoints without editing the HTTP/security layer. */
export function createRoutes({ fleet, billing, token }) {
  return [
    ['GET', /^\/api\/state$/, () => fleet.view()],
    ['GET', /^\/api\/session$/, () => ({ token })],
    ['GET', /^\/api\/export$/, () => fleet.exportRegistry()],
    ['GET', /^\/health$/, () => ({ status: 'ok' })],
    ['POST', /^\/api\/billing\/refresh$/, () => billing.refresh()],
    ['POST', /^\/api\/servers$/, async ({ body }) => fleet.add(await body()), 201],
    [
      'PUT',
      new RegExp(`^/api/servers/${id}/cost$`),
      async ({ params, body }) => fleet.setCost(params[0], (await body())?.cost),
    ],
    [
      'PUT',
      new RegExp(`^/api/servers/${id}$`),
      async ({ params, body }) => fleet.update(params[0], await body()),
    ],
    ['DELETE', new RegExp(`^/api/servers/${id}$`), ({ params }) => fleet.remove(params[0])],
    ['POST', /^\/api\/check$/, async ({ body }) => fleet.check((await body())?.id)],
    ['PUT', /^\/api\/settings$/, async ({ body }) => fleet.setSettings(await body())],
    ['POST', /^\/api\/import$/, async ({ body }) => fleet.importRegistry(await body())],
  ].map(([method, pattern, handle, status = 200]) => ({ method, pattern, handle, status }));
}
