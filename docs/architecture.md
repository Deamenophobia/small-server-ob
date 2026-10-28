# Architecture and extension points

Small Server OB is a local Node.js application with a buildless browser interface. Modules use native ES imports. The server always binds to loopback; configuration cannot turn it into a public service.

```text
server.mjs                    CLI: load environment/config, start, stop
lib/
  app.mjs                     Compose production dependencies
  config.mjs                  Validate defaults, JSON and environment overrides
  http/                       Routing, request parsing, static assets, local security
  services/fleet.mjs          Registry operations, health scheduler, view model
  store.mjs                   Versioned JSON registry, lock, atomic writes, backup
  model.mjs                   Server/settings/cost validation and freshness
  checks/                     Independent HTTP, TCP and SSH adapters
  billing/
    service.mjs               Explicit refresh, cache, credential selection
    providers/                AWS and DigitalOcean response parsing and requests
  costs.mjs                   Calendar-month estimates and currency grouping
  demo/                       Fictional fixtures and an in-memory app
public/
  app.js                      Bootstrap, page state, polling, event coordination
  js/core/                    API client, DOM helpers, config-derived guidance
  js/features/fleet/          Cards, list rendering, server editor, browser preview
  js/features/costs.js        Cost editor and optional billing display
  js/features/workspace.js   Preferences, export and import
  styles/                     Base, layout, fleet, forms, responsive, costs
scripts/                      Syntax check and isolated demo launcher
test/                         Node test runner: integration and contract tests
```

## Request and observation flow

The HTTP layer verifies the Host/Origin and mutation token, matches a route, and passes validated input to a service. The fleet service owns mutations and health scheduling. The store serializes writes and keeps the previous snapshot. The browser receives a view model containing current observations, estimates, public configuration, and already-cached billing status.

Health collection has no path to billing refresh. Billing is queried only by the explicit `POST /api/billing/refresh` route. Credentials remain in the backend. Even an expired billing cache never schedules a refresh itself.

`createApp({ config, dataDirectory, checker, schedule, billingOptions })` is the production composition boundary. Tests replace health adapters and cloud fetchers, use temporary registries, and bind an ephemeral local port. The demo composes the same HTTP/fleet modules with an in-memory store, a synthetic checker, and disabled billing. It never calls the production registry or cloud credential loader.

## Add or replace a health adapter

1. Implement an adapter in `lib/checks/`. It takes `(validatedCheck, config)` and returns `{ status, latencyMs, message, metrics? }`. It must enforce a bounded timeout and release sockets/processes. The checker adds the observation timestamp and maps failures.
2. Register it in `builtinAdapters` in `lib/checks/index.mjs`. `createChecker({ config, adapters })` also accepts a replacement adapter map for tests or embedding.
3. For a **new check type**, extend validation in `lib/model.mjs`, add its fields to the server dialog/editor, and add its observation rendering in `public/js/features/fleet/cards.js`. Merely adding a function does not permit unvalidated input through the API.
4. Add behavioral tests for success, failure, timeout, malformed responses, and serialized configuration. Keep SSH commands fixed, host-key verification enabled, and credentials out of records.

Existing check types remain `ssh`, `http`, and `tcp`. Adapter replacement is a code-level extension point; Small Server OB does not execute arbitrary commands or load untrusted plugins from configuration.

## Add a billing provider

Place response parsing and the bounded provider request in `lib/billing/providers/`. Wire opt-in credentials, cache identity, and the fetcher into `lib/billing/service.mjs`, then add the display metadata in the costs feature. Extend the connection guide and provider parser/cache tests. Missing data must stay unavailable, and provider account totals must remain separate from per-server estimates.

The current service supports one AWS profile and one DigitalOcean team. Its supported injection points are `awsFetcher`, `doFetcher`, `now`, and the environment passed through `billingOptions`. API tests use these to prove that health checks never cause paid billing requests.

## Add a browser feature

Create a module under `public/js/features/` and initialize it from `public/app.js`. Receive `api`, `refresh`, `getState`, and notification callbacks instead of reaching into another feature's state. Use the shared escaping helper for user-controlled markup. Put styles in a feature stylesheet and import it from `public/style.css`; no bundler is required.

The HTTP asset manifest scans only the `public` directory and allowed asset extensions at startup. It does not resolve user-requested URLs into filesystem paths. Restart the backend when adding an asset file; changes to existing assets appear on page reload.

## Compatibility

The registry remains version 1. Existing configurations, costs, notes, links, and observations load without a migration. Health history survives non-target edits, including a pause/resume with reordered check fields. Changing a connection target clears that card's old observations. Configuration changes may intentionally trim retained history; keep a backup before lowering retention if older samples matter.

`lib/checks.mjs`, `lib/billing.mjs`, and `server.mjs` retain stable re-exports for existing imports. Production startup still uses `npm start`.
