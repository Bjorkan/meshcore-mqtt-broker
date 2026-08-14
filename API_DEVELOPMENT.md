# API Development

The API and dashboard are separate request handlers composed by the small Node HTTP listener in `src/web-server.ts`; there is no HTTP framework. `src/api.ts` owns every `/api/*` route, while `src/dashboard.ts` owns only the dashboard shell and its static assets. They still run on one configured port in the same long-lived broker process. The browser dashboard consumes `/api/dashboard` like any other API client.

## Routes

| Method   | Path                                   | Purpose                |
| -------- | -------------------------------------- | ---------------------- |
| GET/HEAD | `/`                                    | Dashboard shell        |
| GET/HEAD | `/api/dashboard`                       | Local broker snapshot  |
| GET/HEAD | `/api/docs`                            | Swagger UI             |
| GET/HEAD | `/api/openapi.json`                    | OpenAPI 3.1 document   |
| GET/HEAD | `/api/v1/nodes[?region=...]`           | Heard node adverts     |
| GET/HEAD | `/api/v1/observers/{publicKey}/status` | Public observer lookup |
| GET/HEAD | `/dashboard-client.js`                 | Bundled React client   |
| GET/HEAD | `/dashboard-client.css`                | Bundled styles         |
| GET/HEAD | `/favicon.svg`                         | Favicon                |

Only GET and HEAD are accepted. API responses use `application/json; charset=utf-8` and `cache-control: no-store`. The routes have no built-in authentication. Anyone who can reach the listener can read dashboard/API data, regardless of MQTT subscriber role.

Swagger UI assets are served locally from the runtime `swagger-ui-dist` dependency under `/api/docs/*`; the documentation page requires no CDN. `/api/openapi.json` is the canonical machine-readable contract. Update `OPENAPI_DOCUMENT` in `src/api.ts` whenever a route, parameter, response, or public schema changes.

Client-facing errors are sanitized. Server logs may contain full error messages, stack traces, paths, client IPs, or database details and must be treated as sensitive operational data. Never deliberately log secrets, JWTs, passwords, or raw sensitive packets.

## Data access

`BrokerStateStore` in `src/state-store.ts` is the focused application-state interface. Durable methods use the managed `ApplicationDatabase`; active subscribers and metrics are intentionally local. API handlers must not open another application connection or scatter SQL through HTTP handler modules.

Useful methods:

- `listPublicBans()` and `listDeniedPublishes()`
- `listObservers()`
- `getObserverNodeNames()`
- `recordHeardNodeAdvert()` and `listHeardNodeAdverts()`
- `listSubscriberConnections()`
- `countBlockedObservers()`

`countBlockedObservers()` returns both the number of distinct valid observer public keys rejected during authentication or publish authorization in the last 24 hours, including wrong-IATA publishes, plus active mutes, and the number of retained public protection-event rows. Repeated failures at any stage count once in `blockedObservers`; malformed or unidentified clients and `would_mute` warning state are excluded. Authentication rejections affect only the aggregate count and are not exposed in the public event list.

Public key helpers are `normalizePublicKey()` and `validatePublicKey()` in `src/state-store.ts`. Validation trims, limits input to 128 characters, requires exactly 64 hexadecimal characters, and returns uppercase.

The observer status endpoint keeps this priority:

1. An active mute or any unexpired denied-publish event returns `blocked`.
2. Otherwise a durable observer row returns `known`.
3. Otherwise return `unknown`.
4. Invalid key input returns HTTP 400 with `invalid`.
5. Storage failure returns HTTP 500 with `error` and no internal detail.

Neighbor data is included only before its durable 48-hour expiration.

The nodes endpoint returns the latest verified advert heard for each node during the rolling last seven days. With no query it returns every retained node. A three-letter `region` value matches any unexpired region hearing for the node; `TEST` behaves like a regular region. The reserved `SWE` filter instead requires advert coordinates inside the bundled Natural Earth Sweden multipolygon. Nodes without coordinates are therefore excluded from `SWE`. Invalid or repeated `region` parameters return HTTP 400.

The response contains `generatedAt`, the normalized `region` or `null`, `count`, and `nodes`. Each node includes its public key, advert timestamp and type, optional name and coordinates, the verified raw packet as lowercase hexadecimal, `advertHeardAt` for that retained copy, and node-wide `heardAt`/`expiresAt` millisecond values. `regions` is the sorted list of all MQTT regions where the node was heard during the last seven days. `regionHearings` contains each region's latest observer public key and independent `heardAt`/`expiresAt` values. A later advert timestamp replaces the stored advert copy. An equal advert heard later refreshes it. A valid older advert refreshes its own region hearing but never replaces a newer advert copy.

Denied-publish events remain for 24 hours and do not by themselves mute MQTT traffic, but they take precedence over a `known` observer response during that retention window.

`/api/dashboard` uses `regionLookup` for public region metadata. Each entry contains required `primaryRegion`, `isPrimary`, and `isAllowed` fields plus optional `friendlyName`. An enabled whitelist includes allowed primaries and known disallowed secondaries; a disabled whitelist returns an empty lookup.

`countyLookup` is a deprecated compatibility alias and must not be used by new clients. Its legacy entries contain `countyName`, `primaryIata`, and `isPrimary`; it does not expose `isAllowed`. Remove the alias only in a documented breaking release.

The dashboard response retains singular-deployment compatibility names including `respondingBroker`, `brokers`, `brokerId`, `activeBrokers`, and `totalBrokers`. `brokers` contains at most the local broker entry; these fields are not a scaling contract.

Dashboard bootstrap configuration is limited to validated public branding and `iataWhitelistEnabled`. Never serialize the complete YAML document. Embedded JSON must escape HTML-significant characters so configured text cannot terminate its script element. `/api/dashboard` separately returns operational observer, neighbor, subscriber connection/subscription, protection, and integration state.

## Adding an endpoint

Add a narrow path branch in `createApiHandler()` and document it in `OPENAPI_DOCUMENT`. Do not add API routing to `createDashboardHandler()`. Decode path parameters inside `try/catch`; malformed percent encoding throws. Validate and bound every parameter before calling a store method. Use prepared statements in a focused store method if new durable data is needed. Never interpolate external values into SQL.

New public endpoint behavior belongs in `README.md`. Data-flow or schema changes belong in `ARCHITECTURE.md`. Add realistic tests using `openTestDatabase()` and a temporary file-backed database; do not introduce production path settings or in-memory fallbacks.

## Tests

Tests import built modules from `dist/`. `npm test` builds first and requires no external service. Database tests must close connections and remove temporary files. Important patterns are in:

- `tests/database.test.mjs`
- `tests/state-store.test.mjs`
- `tests/aedes-persistence-turso.test.mjs`
- `tests/runtime-local.test.mjs`
- `tests/healthcheck-local.test.mjs`

Run `npm test` after API changes; the script performs a clean build first.
