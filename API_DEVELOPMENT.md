# API Development

The dashboard, public HTTP V2 adapter, and MCP protocol are separate handlers composed by the small Node HTTP listener in `src/web-server.ts`; there is no HTTP framework. They share the configured MQTT WebSocket port and the broker's one long-lived process.

## Routes

| Method   | Path                    | Purpose                             |
| -------- | ----------------------- | ----------------------------------- |
| GET/HEAD | `/`                     | Dashboard shell                     |
| GET/HEAD | `/api/dashboard`        | Dashboard-only operational snapshot |
| GET/HEAD | `/api/v2/docs`          | Swagger UI for the REST API         |
| GET/HEAD | `/api/v2/openapi.json`  | Generated OpenAPI document          |
| GET/HEAD | `/api/v2`               | Public REST discovery               |
| MCP      | `/mcp/v2`               | Public MCP V2 Streamable HTTP       |
| GET/HEAD | `/dashboard-client.js`  | Bundled dashboard client            |
| GET/HEAD | `/dashboard-client.css` | Bundled dashboard styles            |
| GET/HEAD | `/favicon.svg`          | Favicon                             |
| any      | `/api/v1`, `/api/v1/*`  | Removed; returns HTTP `410`         |

Dashboard routes remain GET/HEAD-only. Fastify owns HTTP routing for the REST API and delegates the exact MCP route and the dashboard handlers as raw fallbacks. All public routes are anonymous; MQTT subscriber roles do not apply.

## One contract, two transports

The shared `PublicMcpQueryService` owns all MeshCore query semantics, DTO mapping, cursor pagination, and validation. The official MCP V2 server binds its tools to that service, and the Fastify REST routes call the same methods. Do not create a second query implementation in either transport.

```text
MCP /mcp/v2 ──────────┐
                      ├─ PublicMcpQueryService
REST /api/v2 ─────────┘        │
                               ▼
                        PublicMcpDataPolicy
```

Both transports therefore use identical:

- query semantics, bound SQL, and retention-clamped ranges;
- public DTO shapes and shared Zod schemas;
- cursor pagination, result limits, and cross-field validation;
- the field- and source-based public output policy (public MeshCore values are preserved, sensitive field names such as `mqtt.email` and broker client/connection IP fields are blocked);
- fail-closed and 4 MiB serialized-output limits.

Fastify adds transport concerns: routing, request/response schema validation and serialization, a 1 MiB body limit, typed error mapping, no-store responses, and structured logs. The shared listener bounds incomplete HTTP requests to 30 seconds, headers to 15 seconds, and idle keep-alive connections to 5 seconds. It returns HTTP `400` for invalid arguments, `404` for unknown routes, `413` for oversized requests, `500` for safe query/output failures, and `503` when concurrency is exhausted.

## OpenAPI and Swagger

Fastify route schemas are the source of truth for OpenAPI. `@fastify/swagger` generates the document served at `/api/v2/openapi.json` with Swagger UI at `/api/v2/docs`, covering every REST route such as:

```text
GET /api/v2/observers
GET /api/v2/packets
GET /api/v2/activity
```

Each operation has its own request form and exact response schema. Adding a REST route with a response schema automatically adds its OpenAPI path; OpenAPI tests fail if the generated document diverges from the registered routes.

Swagger UI assets are served locally from an explicit allowlist in `swagger-ui-dist`. There is no CDN or remote schema validator. The content-security policy is same-origin, and “Try it out” supports only GET discovery and read-only public-tool POST requests.

## Adding or changing a public query

1. Add or update the query in `PublicMcpQueryService` using bound parameters, deterministic ordering, indexes, bounded output, and no writes.
2. Register the operation with `registerPublicTool()` in the focused core/network module.
3. Use strict Zod input and output objects; avoid unrestricted additional properties.
4. Return an explicit public DTO through `publicMcpToolResult()` so the final policy runs before either transport serializes it.
5. Update [`MCP.md`](MCP.md) and user-facing examples when behavior changes.
6. Add query tests, serialized security tests, and MCP/HTTP parity coverage.

Never add generic SQL, table, raw MQTT event, filesystem, configuration, environment, log, or mutation operations. Unknown MQTT topics, `/internal`, `$SYS`, and serial traffic are outside the public query source allowlist.

## Dashboard boundary

`/api/dashboard` remains an unversioned compatibility route used by the bundled browser dashboard. It is not part of the public query catalog and can contain operational subscriber/integration state that the V2 tool API deliberately excludes. `src/dashboard.ts` owns the shell/static assets; `src/api.ts` owns dashboard snapshot routing, discovery, OpenAPI, Swagger, and the explicit V1 removal response.

## Tests

Tests import built modules from `dist/`. `npm test` builds first and requires no external service. Important coverage is in:

- `tests/api.test.mjs`: generated Swagger paths/schemas, discovery, and V1 removal;
- `tests/mcp-integration.test.mjs`: every MCP tool contract over the official client;
- `tests/mcp-core-tools.test.mjs` and `tests/mcp-network-tools.test.mjs`: normalized query behavior;
- `tests/mcp-public-policy.test.mjs`: adversarial field-blocking policy, preserved public values, fail-closed behavior, and output size;
- `tests/runtime-local.test.mjs`: shared-listener behavior.

Run:

```bash
npm run check
npm test
```
