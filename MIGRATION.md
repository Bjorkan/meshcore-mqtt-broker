# Migration

This page documents deployment, configuration, and HTTP API compatibility changes for existing installations. Database import, schema migration, rollback, and old-database compatibility do not exist.

## Public MCP V2 endpoint

The shared listener now exposes `/mcp/v2` as a public, anonymous, read-only MCP Streamable HTTP endpoint. It uses the stable MCP V2 SDK and reads the normalized history already stored by the broker; it adds no port, process, database, schema migration, credential, or external dependency. Existing reverse proxies must allow MCP protocol `POST` requests to this exact path if the endpoint should be reachable.

The endpoint is enabled by default. Operators may add the explicit defaults below or set `enabled: false`:

```yaml
mcp:
  enabled: true
  path: /mcp/v2
  default_limit: 50
  max_limit: 250
```

Treat endpoint reachability as a public-data disclosure decision. Complete public keys, public advert locations, raw public packet bytes, RF observations, traces, telemetry, and available public message plaintext can be queried. Subscriber/socket data, secrets, private/internal topics, database details, generic raw MQTT payloads, SQL, and filesystem access are excluded and guarded by a centralized fail-closed output policy. See [`MCP.md`](MCP.md) before enabling Internet access.

The same 37 read-only calls are also available without an MCP client through `POST /api/v2/tools/{toolName}`. Existing reverse proxies that should expose this API must allow JSON POST requests under that exact prefix. `GET /api/v2` provides discovery. The HTTP adapter has no independent query or security implementation: it uses the same registry, arguments, output, retention, pagination, limits, and sanitizer as MCP. This API remains enabled as part of the public HTTP surface even when `mcp.enabled` disables the MCP protocol endpoint.

## Retention-bounded MQTT history schema

The clean-install schema now includes the raw-first public MQTT history documented in `DATABASE.md` and `INGEST.md`. Any database from a build without this exact schema is intentionally incompatible. Initialized broker startup closes and permanently deletes it and its known sidecars, then creates schema version `1`; it does not copy old observer, packet, node, queue, or history rows.

Before upgrading, stop the old container and copy the complete bind-mounted data directory if the old contents are needed. Add or review the following read-only YAML settings:

```yaml
storage:
  retention_days: 30
  cleanup_interval_minutes: 60
  cleanup_batch_size: 1000
```

All three values must be integers of at least `1`. Retention is based on the broker's original UTC receipt time, not a MeshCore-reported timestamp or reprocessing time. The embedded in-process collector adds no service, database, port, or cloud dependency.

## Verified node storage schema

Verified advert ingestion adds the `heard_node_adverts` and `heard_node_regions` tables to the clean-install schema. They feed the dashboard and the public V2 query tools. A database created by an earlier build is intentionally incompatible. Stop the old container and preserve the bind-mounted directory before upgrading if its contents are needed. On the first broker start, the incompatible database and its sidecars are permanently deleted and a new empty current schema is created. There is no in-place schema migration, backup created by the broker, or advert-history import. Healthchecks and CLI commands validate existing storage without triggering deletion.

## Public API V1 removal

The bespoke `/api/v1` resources have been removed. Requests to `/api/v1` or any path below it now receive HTTP `410 Gone`; clients must move to the shared V2 tool API. Discovery at `GET /api/v2` lists every available operation and its exact `POST` path. Swagger UI at `/api/docs` documents each operation with its real request and response schema and supports direct calls through **Try it out**.

Common replacements are:

- `/api/v1/observers` → `POST /api/v2/tools/list_observers`;
- `/api/v1/observers/{publicKey}/status` → `POST /api/v2/tools/get_observer` with `{"public_key":"..."}`;
- `/api/v1/nodes` → `POST /api/v2/tools/list_nodes`;
- `/api/v1/nodes/{publicKey}` → `get_node`, `get_node_adverts`, or `get_node_sightings`, depending on the required detail;
- `/api/v1/regions` → `get_network_summary` or one of the region-filtered list operations.

The V2 API deliberately mirrors MCP rather than preserving V1-specific response shapes. Update clients to send a JSON object and consume the normalized `{ data, meta }` response documented for the selected operation. The dashboard continues to use the separate `/api/dashboard` compatibility contract.

The broker records verified signed adverts from accepted MQTT `raw` and `packets` publishes even when MeshCore.io is disabled. It retains one latest advert copy per node and one independently expiring last-heard row per `(node, region)`. Both use a rolling seven-day lifetime. A valid older advert can refresh where the node was heard without replacing a newer retained advert.

The public documentation routes remain `/api/openapi.json` for the generated OpenAPI 3.1 contract and `/api/docs` for locally served Swagger UI. API errors use only `code` and `message`, because the HTTP status already communicates the error category.

## Region authorization

`IATA_whitelist` now controls whether `allowed_regions` is enforced. Existing deployments that contain `allowed_regions` retain whitelist enforcement when this setting is absent. To disable their existing allowlist explicitly, add:

```yaml
IATA_whitelist: false
```

The shipped clean-install configuration explicitly disables whitelisting. In that state, publishes accept the case-insensitive `test` region or exactly three uppercase ASCII letters other than the reserved placeholder `XXX`.

Move disallowed aliases beneath the allowed primary region. This is a one-time manual configuration change; there is no importer for the removed Swedish county JSON format.

```yaml
allowed_regions:
  MMX:
    friendly_name: Malmö Sturup och södra Skåne
    secondary_region: AGH, KID
```

Existing list entries and object entries containing only `friendly_name` continue to work with the preserved or explicitly enabled whitelist.

Object keys with no value also remain valid primaries:

```yaml
allowed_regions:
  STO:
  MMX:
```

## Meshat deployment branding

The previous Meshat.se dashboard text and website link can be approximated through operator configuration:

```yaml
branding:
  operator_name: Meshat.se
  dashboard_title: Meshat.se MeshCore MQTT Broker
  dashboard_subtitle: Meshat.se operations dashboard
  website_url: https://meshat.se/
```

Transfer any required primary/secondary relationships into `config.yaml`; the broker no longer downloads or reads a separate county data file.

## Shared MQTT and HTTP listener

MQTT WebSocket upgrades, the dashboard, and the API now use the single `mqtt.host`/`mqtt.ws_port` listener. Ordinary HTTP requests on that port no longer redirect to the previous fixed fallback; they are routed to the dashboard/API handlers and receive their normal `404`, `405`, or `503` responses when no route succeeds.

Remove the obsolete `dashboard.port` setting when updating configuration. It is ignored if left in an older YAML file. Publish or proxy only the MQTT WebSocket port; the Compose example now maps host port `443` to internal port `8883` and no longer publishes `8080`. Existing TLS deployments must route both ordinary HTTPS requests and WebSocket upgrades to that same internal port. The Node.js listener remains plain HTTP/WebSocket and does not terminate TLS.

Configuration validation and configured secondary-region corrections now use neutral English text. Other established fork-local operator/runtime wording is unchanged.

## Dashboard API

The bundled map now uses MapLibre GL JS 6 and therefore requires WebGL2. The build emits a dedicated same-origin map worker that the dashboard handler serves from `/maplibre-gl-worker.js`; no additional container, port, reverse-proxy route, or external worker service is required.

Use `regionLookup` instead of `countyLookup` in `/api/dashboard`. The deprecated `countyLookup` alias remains in the current release and will only be removed in a documented breaking release.

The dashboard and API remain separate request handlers on the listener now shared with MQTT WebSocket upgrades. The browser dashboard reads `/api/dashboard` as an API client; custom integrations should use the documented `/api/*` routes rather than dashboard static assets.

All dashboard and public V2 routes remain unauthenticated and read-only. Depending on the selected tool, V2 can expose verified raw advert packets, node and observer public keys, public coordinates, RF observations, traces, telemetry, message plaintext, and per-region hearing times. Review network or reverse-proxy access controls before deploying the updated image.
