# API Development

The dashboard and API use Node's `http.createServer` in `src/dashboard.ts`; there is no HTTP framework. MQTT and HTTP run in the same single process.

## Routes

| Method   | Path                                   | Purpose                |
| -------- | -------------------------------------- | ---------------------- |
| GET/HEAD | `/`                                    | Dashboard shell        |
| GET/HEAD | `/api/dashboard`                       | Local broker snapshot  |
| GET/HEAD | `/api/v1/observers/{publicKey}/status` | Public observer lookup |
| GET/HEAD | `/dashboard-client.js`                 | Bundled React client   |
| GET/HEAD | `/dashboard-client.css`                | Bundled styles         |
| GET/HEAD | `/favicon.svg`                         | Favicon                |

Only GET and HEAD are accepted. API responses use `application/json; charset=utf-8` and `cache-control: no-store`. Errors sent to clients must be sanitized; log details server-side without secrets, JWTs, passwords, raw sensitive packets, client IPs, database internals, paths, or stack traces.

## Data access

`BrokerStateStore` in `src/state-store.ts` is the focused application-state interface. Durable methods use the managed `ApplicationDatabase`; active subscribers and metrics are intentionally local. API handlers must not open another application connection or scatter SQL through `dashboard.ts`.

Useful methods:

- `listPublicBans()` and `listDeniedPublishes()`
- `listObservers()`
- `getObserverNodeNames()`
- `listSubscriberConnections()`
- `countBlockedObservers()`

Public key helpers are `normalizePublicKey()` and `validatePublicKey()` in `src/state-store.ts`. Validation trims, limits input to 128 characters, requires exactly 64 hexadecimal characters, and returns uppercase.

Protection entries in the `/api/dashboard` `bans` array may include an `eventId`. The field is the stable, unique identity of a denied-publish history event and remains unchanged across broker restarts while that event is retained. It is optional for additive client compatibility and is omitted from trust-state mute summaries.

The observer status endpoint keeps this priority:

1. A matching active protection/denial record returns `blocked`.
2. Otherwise a durable observer row returns `known`.
3. Otherwise return `unknown`.
4. Invalid key input returns HTTP 400 with `invalid`.
5. Storage failure returns HTTP 500 with `error` and no internal detail.

Neighbor data is included only before its durable 48-hour expiration.

## Adding an endpoint

Add a narrow path branch in `createDashboardServer()`. Decode path parameters inside `try/catch`; malformed percent encoding throws. Validate and bound every parameter before calling a store method. Use prepared statements in a focused store method if new durable data is needed. Never interpolate external values into SQL.

New public endpoint behavior belongs in `README.md`. Data-flow or schema changes belong in `ARCHITECTURE.md`. Add realistic tests using `openTestDatabase()` and a temporary file-backed database; do not introduce production path settings or in-memory fallbacks.

## Tests

Tests import built modules from `dist/`. `npm test` builds first and requires no external service. Database tests must close connections and remove temporary files. Important patterns are in:

- `tests/database.test.mjs`
- `tests/state-store.test.mjs`
- `tests/aedes-persistence-turso.test.mjs`
- `tests/runtime-local.test.mjs`
- `tests/healthcheck-local.test.mjs`

Run `npm run build` and `npm test` after API changes.
