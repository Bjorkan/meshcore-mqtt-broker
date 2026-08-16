# Migration

This page documents deployment, configuration, and HTTP API compatibility changes for existing installations. Database import, schema migration, rollback, and old-database compatibility do not exist.

## Channel decryption, path/event tools, and replaced path endpoints

The `messages` table gains `channel_name`, `decrypted_sender`, and `decrypted_flags` columns in the clean-install schema; databases from earlier builds are incompatible and are deleted on boot as usual (stop the container and back up the data directory first if its contents are needed).

New opt-in configuration:

```yaml
decryption:
  enabled: false
  hashtag_channels: []
  channels: []
```

Disabled by default. Enabling it makes everything in the lists public through the anonymous MCP/REST surface, including the channel PSKs of explicit `channels` entries. See [`CONFIGURATION.md`](CONFIGURATION.md) and [`SECURITY.md`](SECURITY.md).

New MCP tools: `search_paths`, `search_path_prefixes`, `search_events`, and `get_message_payloads`. New REST resources: `GET /api/v2/paths`, `GET /api/v2/path-prefixes`, `GET /api/v2/events`, and `POST /api/v2/batch/message-payloads`. Message DTOs gain `channel_name`, `channel_key`, `decrypted_sender`, `decrypted_flags`, `signature`, and (on `get_message` / `GET /api/v2/messages/:messageId`) `payload_hex`.

Breaking replacements:

- MCP `get_packet_observations` is removed → use `search_paths` with `packet_hash`; note that `search_paths` returns only observations that have an observed routed path.
- MCP `get_packet_path` is removed → use `search_paths` with `packet_hash`; per-hop candidate sets, confidence, and indexes are preserved in the returned `hops`.
- REST `GET /api/v2/raw-packets/:packetHash/observations` and `GET /api/v2/raw-packets/:packetHash/path` are removed (now `404`) → use `GET /api/v2/paths?packet_hash=...`.

Early adopters of this surface: `search_paths` previously accepted a `resolution_status` filter; it is renamed to `contains_resolution_status` to make its contains-semantics explicit (a mixed path can match several statuses), and hop filters are bounded to 0..64.

`search_events` replaces the never-implemented `get_changes`: clients send `from=<their watermark>` and page with the opaque cursor; the server stores no client state. `from` is inclusive and event types can share a timestamp, so the documented watermark pattern is to page with the cursor until `has_more` is `false` and then advance `from` to the last consumed timestamp plus one millisecond.

### Stateless cursors

All public V2 cursors are now self-contained and HMAC-signed with a secret persisted in the broker database (`cursor_signing_secret`). The secret is shared by all instances against the same database and survives restarts, so pagination works across instances and process restarts without server state. Concretely:

- Continuation pages may send only the cursor and a new `limit`; filters do not have to be repeated. Re-supplied filters must equal the cursor's canonical filters.
- Cursors issued by previous builds are invalid and receive `invalid_request` (`invalid_pagination_cursor`) — clients must restart pagination once after this upgrade.
- Every paginated tool freezes its effective time window (`effective_from` and `effective_to`, including implicit defaults) in the cursor, so live ingest no longer changes in-flight result sets (most visible in `search_path_prefixes` sorted by `occurrence_count`/`last_seen_at`).
- Cursors entirely outside the retained window fail with `cursor_outside_retention_window`; a signed cursor with an unknown version fails with `unsupported_cursor_version`.
- `get_capabilities`/`get_schema` now declare the stateless contract (`stateless_queries`, `stateless_cursors`, `cursor_version`, `cursor_integrity_protected`, `pagination_mode`, `supports_snapshot_watermark`, `cursor_semantics`).
- Cursor schemas accept up to 4,096 characters (previously 512), because maximal filter sets produce cursors larger than 512.
- Endpoints with required identity/window arguments now accept continuation pages with only `cursor` and `limit`; the arguments are required only on the first page (`get_observer_status_history`, `get_neighbor_history`, `get_node_adverts`, `get_node_sightings`, `get_node_position_history`, `get_signal_history`, `get_activity_timeseries`).
- `search_messages(view="raw")` now returns one row per raw packet (previously per observation) with a new `observation_count`; logical rows add window-scoped `raw_packet_hashes` and report the matched hash in `packet_hash` when a `packet_hash` filter is used. `search_adverts.raw_packet_hashes` is now scoped to the same window and region as `raw_packet_count`. `search_events` packet events are aggregate-scoped with `observer_public_key`/`rssi`/`snr` set to `null`, and advert events carry their observation's RSSI/SNR.
- `list_nodes`/`list_observers` sort values are computed as of the `as_of` snapshot time frozen in the cursor; `search_paths`/`search_path_prefixes` freeze a `resolution_as_of` resolution snapshot in the cursor.

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

The same read-only MeshCore history is available without an MCP client through the public REST API at `/api/v2`; the earlier `POST /api/v2/tools/{toolName}` mirror has been removed. Existing reverse proxies that should expose this API must allow JSON POST requests under that exact prefix. `GET /api/v2` provides discovery. The HTTP adapter has no independent query or security implementation: it uses the same registry, arguments, output, retention, pagination, limits, and sanitizer as MCP. This API remains enabled as part of the public HTTP surface even when `mcp.enabled` disables the MCP protocol endpoint.

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

The bespoke `/api/v1` resources have been removed. Requests to `/api/v1` or any path below it now receive HTTP `410 Gone`; clients must move to the shared V2 tool API. Discovery at `GET /api/v2` lists the available REST resources. Swagger UI at `/api/v2/docs` documents each operation with its real request and response schema and supports direct calls through **Try it out**.

Common replacements are:

- `/api/v1/observers` → `POST /api/v2/tools/list_observers`;
- `/api/v1/observers/{publicKey}/status` → `POST /api/v2/tools/get_observer` with `{"public_key":"..."}`;
- `/api/v1/nodes` → `POST /api/v2/tools/list_nodes`;
- `/api/v1/nodes/{publicKey}` → `get_node`, `get_node_adverts`, or `get_node_sightings`, depending on the required detail;
- `/api/v1/regions` → `get_network_summary` or one of the region-filtered list operations.

The V2 API deliberately mirrors MCP rather than preserving V1-specific response shapes. Update clients to send a JSON object and consume the normalized `{ data, meta }` response documented for the selected operation. The dashboard continues to use the separate `/api/dashboard` compatibility contract.

The broker records verified signed adverts from accepted MQTT `raw` and `packets` publishes even when MeshCore.io is disabled. It retains one latest advert copy per node and one independently expiring last-heard row per `(node, region)`. Both use a rolling seven-day lifetime. A valid older advert can refresh where the node was heard without replacing a newer retained advert.

The public documentation routes are `/api/v2/openapi.json` for the generated OpenAPI contract and `/api/v2/docs` for locally served Swagger UI. API errors use only `code` and `message`, because the HTTP status already communicates the error category.

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
