# API Development

The API and dashboard are separate request handlers composed by the small Node HTTP listener in `src/web-server.ts`; there is no HTTP framework. `src/api.ts` owns every `/api/*` route, while `src/dashboard.ts` owns only the dashboard shell and its static assets. They run on the same configured port as MQTT WebSocket upgrades in the same long-lived broker process. The browser dashboard consumes `/api/dashboard` like any other API client.

## Routes

| Method   | Path                                   | Purpose                |
| -------- | -------------------------------------- | ---------------------- |
| GET/HEAD | `/`                                    | Dashboard shell        |
| GET/HEAD | `/api/dashboard`                       | Local broker snapshot  |
| GET/HEAD | `/api/docs`, `/api/docs/`              | Swagger UI shell       |
| GET/HEAD | `/api/docs/swagger-initializer.js`     | Local Swagger setup    |
| GET/HEAD | `/api/docs/{approved asset}`           | Local Swagger CSS/JS   |
| GET/HEAD | `/api/openapi.json`                    | OpenAPI 3.1 document   |
| GET/HEAD | `/api/v1`, `/api/v1/`                  | Public API discovery   |
| GET/HEAD | `/api/v1/regions`                      | Region/node counts     |
| GET/HEAD | `/api/v1/nodes[?filters...]`           | Heard node summaries   |
| GET/HEAD | `/api/v1/nodes/{publicKey}`            | One heard node         |
| GET/HEAD | `/api/v1/observers[?...]`              | Public observer list   |
| GET/HEAD | `/api/v1/observers/{publicKey}/status` | Public observer lookup |
| GET/HEAD | `/dashboard-client.js`                 | Bundled React client   |
| GET/HEAD | `/dashboard-client.css`                | Bundled styles         |
| GET/HEAD | `/favicon.svg`                         | Favicon                |

Only GET and HEAD are accepted; other API methods return JSON `405` with `Allow: GET, HEAD`, and unmatched API paths return JSON `404`. JSON API responses use `application/json; charset=utf-8` and `cache-control: no-store`. Swagger distribution assets use a one-day public cache; the UI shell, initializer, and OpenAPI document are not cached. The routes have no built-in authentication. Anyone who can reach the listener can read dashboard/API data, regardless of MQTT subscriber role.

Swagger UI assets are served locally from an explicit allowlist in the runtime `swagger-ui-dist` dependency under `/api/docs/*`; arbitrary files cannot be read through that path. The documentation page requires no CDN, enables only GET requests in “Try it out,” disables remote schema validation, and uses a same-origin content-security policy. `/api/openapi.json` is the canonical machine-readable contract. Update `OPENAPI_DOCUMENT` in `src/api.ts` whenever a route, parameter, response, or public schema changes.

Client-facing errors are sanitized and contain only stable `code` and `message` fields. The HTTP status already distinguishes invalid requests, missing resources, method errors, and server failures, so a second JSON status field would be redundant. Server logs may contain full error messages, stack traces, paths, client IPs, or database details and must be treated as sensitive operational data. Never deliberately log secrets, JWTs, passwords, or raw sensitive packets.

`/api/dashboard` is intentionally unversioned because it is the dashboard application's compatibility surface. Public external resources are under `/api/v1`. Their responses must omit broker instance IDs, subscriber details, recent message lists, integration state, internal counters, and configuration enforcement flags unless a future external use case explicitly requires one. API routing belongs only to `createApiHandler()`; dashboard shell/static routing belongs only to `createDashboardHandler()`. `createWebServer()` owns method enforcement, handler ordering, fallback errors, and the HTTP side of the listener shared with MQTT WebSocket upgrades.

## Public resource design

The public routes are organized for non-admin clients such as maps, node directories, regional views, and small monitoring integrations:

- collection routes return arrays and accept filters that do not change the item schema;
- identity paths such as `/nodes/{publicKey}` perform one-resource lookup and can return HTTP 404;
- the node collection is lightweight, while node detail adds the large raw advert and per-observer hearings;
- `/regions` is metadata for building region selectors and summaries, not an alternate representation of a node list;
- `/observers/{publicKey}/status` is a computed status check that can also represent an unseen or blocked key, rather than a stored observer-detail resource;
- `/api/v1`, OpenAPI, and Swagger are discovery/documentation resources and do not contain live broker state.

Do not combine these into mode switches such as `?resource=nodes`, `?groupBy=region`, or `?include=raw`. Those parameters would make one URL return unrelated schemas, make caching and generated clients less predictable, and let a supposedly lightweight list accidentally become very large. Query parameters remain appropriate for narrowing a collection by `region`, `active`, or `limit` because the response item type stays the same.

## Data access

`BrokerStateStore` in `src/state-store.ts` is the focused application-state interface. Durable methods use the managed `ApplicationDatabase`; active subscribers and metrics are intentionally local. API handlers must not open another application connection or scatter SQL through HTTP handler modules.

Useful methods:

- `listPublicBans()` and `listDeniedPublishes()`
- `listObservers()`
- `getObserverNodeNames()`
- `recordHeardNodeAdvert()`, `listHeardNodeAdverts()`, and `getHeardNodeAdvert()`
- `listSubscriberConnections()`
- `countBlockedObservers()`

`countBlockedObservers()` returns both the number of distinct valid observer public keys rejected during authentication or publish authorization in the last 24 hours, including wrong-IATA publishes, plus active mutes, and the number of retained public protection-event rows. Repeated failures at any stage count once in `blockedObservers`; malformed or unidentified clients and `would_mute` warning state are excluded. Authentication rejections affect only the aggregate count and are not exposed in the public event list.

Public key helpers are `normalizePublicKey()` and `validatePublicKey()` in `src/state-store.ts`. Validation trims, limits input to 128 characters, requires exactly 64 hexadecimal characters, and returns uppercase.

The observer status endpoint keeps this priority:

1. An active mute or any unexpired denied-publish event returns `blocked`.
2. Otherwise a durable observer row returns `known`.
3. Otherwise return `unknown`.
4. Invalid key input returns HTTP 400 with code `invalid_request`.
5. Storage failure returns HTTP 500 with code `internal_error` and no internal detail.

Neighbor data is included only before its durable 48-hour expiration.

The observer list returns only public key, friendly/fallback name, MQTT region, active state, and last-seen time. It defaults to active observers and accepts one normalized `region`, `active=true|false|all`, and an integer `limit` from 1 through 1,000. Filtering happens over at most 1,000 deterministically ordered durable observer rows. Recent messages, broker IDs, connection counts, and abuse details are not part of this list. Status lookup is flat rather than wrapping these identity fields in another `observer` object. Its optional `block` object contains only machine-readable action, reason, and expiration when one exists.

The nodes endpoint returns the latest verified advert heard for each node during the rolling last seven days. Adverts are collected independently of the MeshCore.io integration from accepted `raw` and `packets` MQTT publishes, and only decodable ADVERT packets with a valid Ed25519 signature are recorded. With no query the endpoint returns every retained node. A case-insensitive three-letter `region` value matches any unexpired region hearing for the node; `TEST` behaves like a regular region. The reserved `SWE` filter instead requires advert coordinates inside the bundled Natural Earth Sweden multipolygon. Nodes without coordinates are therefore excluded from `SWE`. The case-insensitive `type` filter performs an exact advert-type match. `hasLocation=true` requires both coordinates, while `false` selects nodes missing either one. Filters may be combined. Invalid or repeated filter parameters return HTTP 400.

The collection response contains `generatedAt`, normalized `filters`, `count`, and lightweight `nodes`. Each summary includes its public key, advert timestamp and type, optional name and coordinates, node-wide `heardAt`/`expiresAt`, and `regions`, the sorted list of every MQTT region where the node was heard during the last seven days. It omits the raw packet and per-observer rows so a Sweden-wide map does not download detail data for every node. `/api/v1/nodes/{publicKey}` performs a bounded direct lookup and adds the verified `rawPacketHex`, `advertHeardAt`, and `regionHearings` with each region's latest observer public key and independent `heardAt`/`expiresAt` values, or returns sanitized HTTP 404. A later advert timestamp replaces the stored advert copy. An equal advert heard later refreshes it. A valid older advert refreshes its own region hearing but never replaces a newer advert copy.

Node list reads are deterministic and bounded to 10,000 selected nodes and 100,000 joined active region-hearing rows. Nodes are ordered by most recent hearing and then public key; each node's regions are ordered by normalized region code. Raw verified packets and observer keys appear only in node-detail responses, but remain unauthenticated public API data, so deployments must treat API reachability as a data-disclosure decision.

`/api/v1/regions` unions configured public region metadata with regions present in current node hearings. Each entry contains only `code`, display `name`, `primaryRegion`, and `nodeCount`; whitelist enforcement and deployment flags remain internal. The response advertises `SWE` separately as a geographic filter because it is not an MQTT region.

Denied-publish events remain for 24 hours and do not by themselves mute MQTT traffic, but they take precedence over a `known` observer response during that retention window.

`/api/dashboard` uses `regionLookup` for public region metadata. Each entry contains required `primaryRegion`, `isPrimary`, and `isAllowed` fields plus optional `friendlyName`. An enabled whitelist includes allowed primaries and known disallowed secondaries; a disabled whitelist returns an empty lookup.

`countyLookup` is a deprecated compatibility alias and must not be used by new clients. Its legacy entries contain `countyName`, `primaryIata`, and `isPrimary`; it does not expose `isAllowed`. Remove the alias only in a documented breaking release.

The dashboard response retains singular-deployment compatibility names including `respondingBroker`, `brokers`, `brokerId`, `activeBrokers`, and `totalBrokers`. `brokers` contains at most the local broker entry; these fields are not a scaling contract.

Dashboard bootstrap configuration is limited to validated public branding and `iataWhitelistEnabled`. Never serialize the complete YAML document. Embedded JSON must escape HTML-significant characters so configured text cannot terminate its script element. `/api/dashboard` separately returns operational observer, neighbor, subscriber connection/subscription, protection, and integration state.

The dashboard snapshot has these top-level fields:

| Field              | Meaning                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `generatedAt`      | Snapshot time in Unix milliseconds                                                             |
| `respondingBroker` | Local broker instance ID                                                                       |
| `summary`          | Connection, observer, broker-compatibility, message, and protection counters                   |
| `brokers`          | Zero or one local broker metrics entry; not a clustering contract                              |
| `observers`        | Bounded durable/current public observer state                                                  |
| `recentPublishes`  | Bounded recent public publish metadata                                                         |
| `bans`             | Bounded public protection/denial events                                                        |
| `subscribers`      | Active subscriber usernames, client IDs, connection counts, and bounded subscription summaries |
| `regionLookup`     | Canonical configured primary/secondary region metadata                                         |
| `countyLookup`     | Deprecated region compatibility alias                                                          |
| `meshcoreIo`       | Optional integration queue, totals, workers, history, and map state                            |
| `error`            | Optional sanitized snapshot warning                                                            |

## Adding an endpoint

Add a narrow path branch in `createApiHandler()` and document it in `OPENAPI_DOCUMENT`. Do not add API routing to `createDashboardHandler()`. Decode path parameters inside `try/catch`; malformed percent encoding throws. Validate and bound every parameter before calling a store method. Use prepared statements in a focused store method if new durable data is needed. Never interpolate external values into SQL.

New public endpoint behavior belongs in `README.md`. Data-flow or schema changes belong in `ARCHITECTURE.md`. Add realistic tests using `openTestDatabase()` and a temporary file-backed database; do not introduce production path settings or in-memory fallbacks.

## Tests

Tests import built modules from `dist/`. `npm test` builds first and requires no external service. Database tests must close connections and remove temporary files. Important patterns are in:

- `tests/database.test.mjs`
- `tests/state-store.test.mjs`
- `tests/aedes-persistence-turso.test.mjs`
- `tests/api.test.mjs`
- `tests/nodes.test.mjs`
- `tests/runtime-local.test.mjs`
- `tests/healthcheck-local.test.mjs`

Run `npm test` after API changes; the script performs a clean build first.
