# API Development

The dashboard, public HTTP V2 adapter, and MCP protocol are separate handlers composed by the small Node HTTP listener in `src/web-server.ts`; there is no HTTP framework. They share the configured MQTT WebSocket port and the broker's one long-lived process.

## Routes

| Method   | Path                         | Purpose                             |
| -------- | ---------------------------- | ----------------------------------- |
| GET/HEAD | `/`                          | Dashboard shell                     |
| GET/HEAD | `/api/dashboard`             | Dashboard-only operational snapshot |
| GET/HEAD | `/api/docs`, `/api/docs/`    | Local Swagger UI                    |
| GET/HEAD | `/api/docs/{approved asset}` | Allowlisted local Swagger CSS/JS    |
| GET/HEAD | `/api/openapi.json`          | Generated OpenAPI 3.1 document      |
| GET/HEAD | `/api/v2`                    | Public operation discovery          |
| POST     | `/api/v2/tools/{toolName}`   | One public MCP-equivalent query     |
| MCP      | `/mcp/v2`                    | Public MCP V2 Streamable HTTP       |
| GET/HEAD | `/dashboard-client.js`       | Bundled dashboard client            |
| GET/HEAD | `/dashboard-client.css`      | Bundled dashboard styles            |
| GET/HEAD | `/favicon.svg`               | Favicon                             |
| any      | `/api/v1`, `/api/v1/*`       | Removed; returns HTTP `410`         |

Resource and dashboard routes remain GET/HEAD-only. The exact MCP route and `/api/v2/tools/{toolName}` run before the shared GET/HEAD gate. The public tool adapter accepts only JSON POST and returns `Allow: POST` for other methods. All public routes are anonymous; MQTT subscriber roles do not apply.

## One contract, two transports

`registerPublicTool()` records each name, title, description, strict Zod input schema, strict Zod output schema, and handler in `PublicToolRegistry` while also registering it with the official MCP V2 server. The HTTP adapter invokes that registry directly. Do not create a second HTTP-specific query implementation.

```text
MCP /mcp/v2 ───────────────┐
                           ├─ PublicToolRegistry
HTTP /api/v2/tools/<name> ─┘          │
                                      ▼
                          normalized query service
                                      │
                                      ▼
                          PublicMcpDataPolicy
```

Both transports therefore use identical:

- argument validation and defaults;
- strict output-schema validation before a successful result is returned;
- bound SQL and retention-clamped query ranges;
- output DTOs and schemas;
- cursor pagination and result limits;
- the field- and source-based public output policy (public MeshCore values are preserved, sensitive field names such as `mqtt.email` and broker client/connection IP fields are blocked);
- fail-closed and 4 MiB serialized-output limits.

The HTTP adapter adds only transport concerns: a 1 MiB request-body limit, 32 concurrent requests, stable status codes, no-store responses, and safe structured logs. The shared listener bounds incomplete HTTP requests to 30 seconds, headers to 15 seconds, and idle keep-alive connections to 5 seconds. It returns HTTP `400` for invalid arguments, `404` for unknown tool names, `413` for oversized requests, `500` for safe query/output failures, and `503` when concurrency is exhausted.

## OpenAPI and Swagger

`createOpenApiDocument()` reads `PublicToolRegistry.descriptions()` and converts every registered Zod schema to OpenAPI-compatible JSON Schema. Swagger therefore shows 26 distinct paths such as:

```text
POST /api/v2/tools/get_observer
POST /api/v2/tools/search_packets
POST /api/v2/tools/get_activity_timeseries
```

Each operation has its own request form and exact response schema. Adding a registered tool automatically adds its OpenAPI path; the parity tests fail if the MCP, registry, discovery, and Swagger inventories differ.

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
- `tests/mcp-integration.test.mjs`: all 26 operations over both transports with equal structured output;
- `tests/mcp-core-tools.test.mjs` and `tests/mcp-network-tools.test.mjs`: normalized query behavior;
- `tests/mcp-public-policy.test.mjs`: adversarial field-blocking policy, preserved public values, fail-closed behavior, and output size;
- `tests/runtime-local.test.mjs`: shared-listener behavior.

Run:

```bash
npm run check
npm test
```
