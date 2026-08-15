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

## Nodes API schema

The nodes API adds the `heard_node_adverts` and `heard_node_regions` tables to the clean-install schema. A database created by an earlier build is intentionally incompatible. Stop the old container and preserve the bind-mounted directory before upgrading if its contents are needed. On the first broker start, the incompatible database and its sidecars are permanently deleted and a new empty current schema is created. There is no in-place schema migration, backup created by the broker, or advert-history import. Healthchecks and CLI commands validate existing storage without triggering deletion.

## Public API additions

The versioned API now has discovery at `/api/v1`, a bounded observer list at `/api/v1/observers`, a direct node lookup at `/api/v1/nodes/{publicKey}`, and region/node counts at `/api/v1/regions`. These public resources intentionally omit broker instance IDs, subscriber details, recent message lists, integration state, internal counters, and whitelist enforcement flags. `/api/dashboard` remains the separate operational dashboard contract.

The broker records verified signed adverts from accepted MQTT `raw` and `packets` publishes even when MeshCore.io is disabled. It retains one latest advert copy per node and one independently expiring last-heard row per `(node, region)`. Both use a rolling seven-day lifetime. A valid older advert can refresh where the node was heard without replacing a newer retained advert.

The new public routes are:

- `/api/v1/nodes` for all recently heard nodes;
- `/api/v1/nodes?region=ABC` for any active hearing in an MQTT/IATA region;
- `/api/v1/nodes?region=SWE` for latest advert coordinates inside Sweden;
- `/api/v1/nodes?type=REPEATER&hasLocation=true` for a map-ready node subset;
- `/api/openapi.json` for the OpenAPI 3.1 contract;
- `/api/docs` for the locally served Swagger UI.

Node summaries expose `regions`; there is no single authoritative observer region and clients must not infer that the first region is the only place a node was heard. The node-detail route additionally exposes `regionHearings`, `rawPacketHex`, and `advertHeardAt`. `advertTimestamp` is in Unix seconds; `advertHeardAt`, node-wide `heardAt`/`expiresAt`, and each region hearing time are Unix milliseconds. API errors now use only `code` and `message`, because the HTTP status already communicates the error category.

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

Use `regionLookup` instead of `countyLookup` in `/api/dashboard`. The deprecated `countyLookup` alias remains in the current release and will only be removed in a documented breaking release.

The dashboard and API remain separate request handlers on the listener now shared with MQTT WebSocket upgrades. The browser dashboard reads `/api/dashboard` as an API client; custom integrations should use the documented `/api/*` routes rather than dashboard static assets.

All dashboard/API routes remain unauthenticated and read-only. The nodes API additionally exposes verified raw advert packets, node public keys, observer public keys, coordinates when present, and per-region hearing times. Review network or reverse-proxy access controls before deploying the updated image.
