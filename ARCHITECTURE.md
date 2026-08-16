# Architecture

## Runtime

The supported deployment is exactly one container and one long-lived Node.js broker process. That process owns one Aedes instance, its local message emitter, one shared MQTT-over-WebSocket and dashboard/API HTTP server, optional target bridge, optional MeshCore.io workers, one node-advert recorder, and one managed embedded Turso connection. Docker healthchecks and operator-invoked CLI commands run as short-lived auxiliary Node.js processes; they never host another broker or worker replica.

```text
MeshCore observers, subscribers, browsers, and MCP clients
                       |
 shared HTTP/WebSocket listener :8883
 (Compose example publishes host :443)
          |                         |
 WebSocket upgrades          ordinary HTTP
          |                         |
     MQTT / Aedes    dashboard, /api/*, Swagger, /mcp/v2
          |                         |
          +------------+------------+
                       |
       local emitter, durable MQTT history,
             and embedded Turso database
 /data/meshcore-mqtt-broker/meshcore-mqtt-broker.db
```

There is no required external/cloud state service, external database, broker coordination, ownership service, election, failover, replica, or horizontal-scaling mode. Optional target MQTT, MeshCore.io, and browser map tiles are outbound integrations rather than architecture dependencies. The local Aedes emitter is sufficient because no other broker process participates.

## Startup and shutdown

`src/database.ts` is the sole source-code authority for the production directory and filename. Startup recursively creates the fixed directory, verifies that it is a readable/writable directory, opens Turso, initializes and validates the exact schema, and probes it before Aedes or the shared HTTP/WebSocket server starts. An unusable path produces a Swedish fatal error and a non-zero process exit. If initialized broker startup detects an incompatible database, it first closes the connection, deletes the fixed database and known `-wal`, `-shm`, `-tshm`, and `-journal` sidecars, opens a new file, initializes the exact current schema, validates it, and probes it before the listener opens. No automatic backup is made.

The direct idempotent initializer uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` only for an empty database. An existing marked database is validated before any DDL runs, including every required table/column and a fingerprint of table constraints and indexes. Incompatibility replaces the complete database; individual tables or rows are never migrated or repaired. Health and CLI processes use the non-initializing validation path and never trigger deletion.

SIGTERM/SIGINT stops new observer ownership, terminates WebSockets, closes the shared HTTP listener, closes Aedes while local consumers remain available for final publish events, drains MeshCore.io, MQTT history, node-advert, and target-forwarding work, releases process-local state, and asynchronously closes Turso after tracked database operations settle.

## Modules

- `src/database.ts`: fixed path, storage checks, connection ownership, current schema, compatibility validation, health probe.
- `src/aedes-persistence-turso.ts`: retained packets, subscriptions, outgoing/incoming QoS state, wills, streams, wildcard matching, bounded cleanup.
- `src/state-store.ts`: relational observer, trust, denial, node advert/region, and dashboard state plus process-local subscriber sessions and metrics.
- `src/server.ts`: authentication, authorization, single local observer owner, shared MQTT/WebSocket and HTTP runtime, API/dashboard composition, graceful shutdown.
- `src/config.ts`: read-only YAML loading, validation, public branding, and typed region configuration.
- `src/region-registry.ts`: synchronous configuration-backed primary/secondary region lookup with no I/O.
- `src/meshcore-io-runtime.ts`: local durable ingress and upload queue, recovery, retries, history, map state.
- `src/node-adverts.ts`: verified advert decoding and serialized durable recording independent of MeshCore.io.
- `src/mqtt-history.ts`: raw-first accepted publish capture, durable processing, normalization, recovery, reprocessing, retention, and internal metrics.
- `src/mqtt-history-repositories.ts`: bound relational history operations and bounded cleanup.
- `src/mqtt-history-topic.ts`: central public MeshCore topic parser and private-root classification.
- `src/meshcore-packet-decoder.ts`: versioned replaceable MeshCore decoder interface and current adapter.
- `src/sweden-geofence.ts` and `src/sweden-boundary.json`: local point-in-multipolygon filtering against the bundled Sweden boundary.
- `src/api.ts`: V2 discovery, registry-derived OpenAPI contract, V1 removal response, dashboard snapshot routing, and locally served Swagger UI.
- `src/mcp-server.ts`: anonymous MCP V2 server, Streamable HTTP adapter, protocol limits, and lifecycle.
- `src/mcp-core-tools.ts` and `src/mcp-network-tools.ts`: strict read-only public tool contracts.
- `src/mcp-public-query.ts`: bound, bounded normalized-history queries and stable keyset pagination.
- `src/mcp-public-policy.ts`: centralized recursive output allowlisting, field- and source-based sensitive-field blocking, fail-closed validation, metrics, and safe logs.
- `src/public-tool-registry.ts`: transport-neutral registry binding the same schemas and handlers to MCP and plain HTTP.
- `src/public-tool-api.ts`: bounded anonymous JSON `POST` adapter for every registered public query tool.
- `src/dashboard.ts`: dashboard state model, HTML shell, and dashboard-only static asset handler.
- `src/web-server.ts`: HTTP routing for the listener shared by MQTT WebSocket upgrades and independent API/dashboard handlers.
- `src/healthcheck.ts`: real MQTT loopback plus bounded Turso query.
- `src/cli.ts`: fixed-database status, observer listing, abuse operations, and explicit application reset.

## Schema

Columns ending in `_ms` and dashboard/runtime timestamps use Unix milliseconds. `heard_node_adverts.advert_timestamp`, the `advertTimestamp` inside `meshcore_io_jobs.job_json`, and `meshcore_io_node_state.accepted_advert_timestamp` store MeshCore advert timestamps in seconds.

| Table                        | Purpose                                                                      | Important indexes/bounds                                                          |
| ---------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `application_metadata`       | Exact schema identity                                                        | singleton primary key                                                             |
| `retained_packets`           | One retained packet per topic and optional expiration                        | topic PK, expiration index                                                        |
| `mqtt_subscriptions`         | Durable non-clean MQTT subscriptions                                         | `(client_id, topic)` PK, topic index                                              |
| `mqtt_outgoing`              | Ordered offline QoS delivery                                                 | client/order, packet identity and message ID indexes; keyset-paged replay         |
| `mqtt_incoming`              | Incoming QoS 2 packets                                                       | `(client_id, message_id)` PK                                                      |
| `mqtt_wills`                 | Durable Last Wills                                                           | client PK, broker index                                                           |
| `target_retained_clears`     | Pending 48-hour retained-neighbor clears on the target broker                | topic PK, expiration/order index                                                  |
| `observer_profiles`          | Node names and latest accepted status timestamp with independent expirations | identity PK, expiration indexes                                                   |
| `observer_state`             | Current observer/dashboard data and neighbor snapshot                        | identity PK, last-seen and neighbor-expiration indexes; 50 messages per observer  |
| `trust_state`                | Durable abuse state and mute decisions                                       | identity PK, status/order and expiration indexes                                  |
| `denied_publish_events`      | Invalid-region and protection denial history                                 | deterministic event order and expiration indexes; 24-hour retention               |
| `observer_rejection_events`  | Valid observer keys rejected during authentication or publish authorization  | identity/order and expiration indexes; 24-hour retention                          |
| `heard_node_adverts`         | Latest verified raw and decoded advert plus node-wide last-heard time        | node PK, last-heard order and expiration indexes; seven-day retention             |
| `heard_node_regions`         | Latest observer hearing for each node and MQTT region                        | node/region PK, region/order and expiration indexes; seven-day retention          |
| `meshcore_io_ingress`        | Bounded accepted MQTT ingress awaiting parsing                               | identity/order and expiration indexes                                             |
| `meshcore_io_ingress_dedup`  | Exact topic/payload dedup window independent of ingress consumption          | digest PK, expiration index                                                       |
| `meshcore_io_observer_radio` | Validated radio parameters                                                   | observer PK, expiration index; 24-hour retention                                  |
| `meshcore_io_jobs`           | Pending, processing, retry, completed, and dropped jobs                      | unique request, partial unique active node/dedup, claim/order and history indexes |
| `meshcore_io_node_state`     | Cooldown and accepted advert timestamp                                       | node PK, expiration index                                                         |
| `meshcore_io_history`        | Upload/drop history                                                          | deterministic order; newest 100 retained                                          |
| `meshcore_io_map`            | Latest accepted mapped advert per node                                       | node PK, time index; seven-day retention                                          |
| `meshcore_io_stats`          | Durable integration totals and latest error                                  | singleton primary key                                                             |

The historical schema adds raw MQTT receipts and processing errors; observer region/status/metric/radio history; neighbor snapshots and entries; packet identities and observations; decoded paths; nodes, adverts, sightings, and prefix candidates; and normalized trace, message, and telemetry records. `logical_packets` groups raw packets that represent the same logical MeshCore transmission across FLOOD paths (per-type canonical payload identity; decoded payload bytes fall back to the raw hash only for undecodable packets), and `packets.logical_packet_id` links each raw packet to it. Logical grouping is maintained during retention cleanup. [`DATABASE.md`](DATABASE.md) is the table/FK/index reference and contains the ER diagram. [`INGEST.md`](INGEST.md) documents the raw-first data flow and recovery contract.

Externally controlled values are bound parameters. Dynamic identifiers exist only in fixed internal cleanup table lists. Atomic admission, claim, retry transition, completion, drop, observer timestamp ordering, observer snapshot replacement, advert/region-hearing replacement, and reset operations use the `ApplicationDatabase.transaction()` wrapper around the driver's `transactionAsync()` and its dedicated transaction handle. The official driver serializes access on the managed connection; experimental multi-process WAL permits CLI access alongside the broker.

## Aedes persistence

The adapter implements every operation used by Aedes 1.1.1 and the persistence contract: literal async `setup`, retained insert/replace/delete, exact and MQTT wildcard streams, subscription add/remove/restore/topic lookup, offline counts, cleanup, outgoing singular/combined enqueue, replay/update/acknowledgement, incoming QoS 2 operations, wills, client listing, cleanup, and destroy. Complete streams use bounded keyset-paged queries rather than truncating contract results.

Packets are serialized as binary Node values so Buffers and Aedes metadata round-trip; transient function-valued Aedes callbacks are excluded. Retained combination streams preserve Aedes' per-filter behavior when filters overlap. Offline subscription matches collapse overlapping filters to one effective delivery per client at the highest matching QoS. Clean sessions atomically remove subscriptions and both QoS queues. Only the exact `meshcore/{region}/{key}/neighbors` subtopic receives a durable 48-hour expiration. The operator-facing instance ID remains stable while `broker.runtime_id_file` persists; the default `/tmp/mc-mqtt-broker-id` survives only for the life of the container. Each Aedes process also receives a unique runtime identity so outgoing packet counters and crash-surviving wills cannot collide across restart. Communication methods that only connected separate broker processes were deliberately removed because the architecture has one broker and uses Aedes' in-process emitter.

## Ownership and sessions

The process stores one current `MeshAedesClient` per observer public key. Successful newer authentication waits for any in-flight authorization by the current connection, then replaces and closes it. Publish authorization and target forwarding compare object identity with this map. Disconnect removes ownership only if the disconnecting object is still current, preventing stale callbacks from deleting a replacement.

Subscriber connection records and subscription summaries are process-local. Registration replaces the same MQTT client ID atomically within the event loop and returns a UUID generation. Subscription updates and disconnect cleanup require that generation. Restart intentionally clears all active sessions.

## Configuration and regions

Configuration is parsed once before listeners open. The shipped configuration sets `IATA_whitelist` to false; in that state `allowed_regions` is not semantically parsed. Existing configurations without that setting preserve their active allowlist when they contain `allowed_regions`. Publishes otherwise accept the case-insensitive `test` region or exactly three uppercase ASCII letters other than the reserved placeholder `XXX`. When enabled, `src/config.ts` strictly creates primary and secondary maps. `RegionRegistry` is synchronous and performs no HTTP request or separate filesystem read. Invalid relationships therefore fail startup instead of creating runtime reconciliation branches.

MQTT WebSocket upgrades, the MCP handler, the Fastify REST app, the API handler, and the dashboard handler share one HTTP listener and port. The WebSocket server handles upgrades and passes accepted streams to Aedes. Fastify 5 owns HTTP routing for `/api/v2` REST resources, the generated OpenAPI document and Swagger UI, and request validation/serialization; the MCP route handler and the dashboard API/static handlers are delegated as fallbacks; Fastify pre-parses JSON bodies for the MCP fallback so the deployed MCP endpoint reads the same bounded body contract without a second stream read. The shared server applies 30-second request, 15-second header, and 5-second idle keep-alive limits plus `nosniff` and strict-origin referrer headers; upgraded MQTT WebSocket streams are not HTTP keep-alive requests. The dashboard browser code fetches `/api/dashboard` over HTTP. Its MapLibre 6 ESM bundle uses a separately built, same-origin worker served at `/maplibre-gl-worker.js`; both remain container-local assets while map tiles are optional browser-side outbound requests. The unauthenticated dashboard snapshot remains a separate operational compatibility surface. `/api/v1` is removed and returns `410`; public integrations use the REST API at `/api/v2` or MCP at `/mcp/v2`.

The MCP V2 route and the Fastify REST API are unauthenticated and read-only and share one public-history contract documented in [`MCP.md`](MCP.md) and [`REST_API.md`](REST_API.md). REST routes, MCP tools, and the schema dictionary are bound to the same query service, DTO schemas, and public-output policy; there is no second implementation of query semantics. Each request reads only explicit normalized history through bound SQL and passes the complete result through one recursive policy before serialization. Request bodies, concurrent requests, query windows, page sizes, cursor shape, bucket counts, output traversal, and final serialized size are bounded. Graceful shutdown closes the MCP HTTP handler and the Fastify app before the shared database connection.

`/api/v2/openapi.json` is generated by `@fastify/swagger` from the registered route and response schemas, and `/api/v2/docs` serves the bundled Swagger UI with same-origin references, no CDN, and no remote validator. API documentation does not create another process, port, or outbound runtime dependency.

Accepted `raw` and `packets` publishes are also offered to the node-advert recorder whether or not MeshCore.io is enabled. It accepts only decodable ADVERT packets with valid Ed25519 signatures, then stores the raw packet and bounded decoded fields. `heard_node_adverts` permits one retained advert copy per advertised node. Server observation order replaces content: a later hearing wins regardless of the embedded advert timestamp, and an equal-content advert heard later refreshes that copy. Every valid receipt, including an out-of-order older advert, transactionally refreshes the node-wide last-heard time and the corresponding `(node, MQTT region)` row without replacing a newer advert copy. Graceful shutdown drains the serialized recorder before the managed database closes.

The verified latest-advert tables remain part of durable/dashboard state, and the bundled Sweden geofence remains available to the dashboard implementation. External V2 node, advert, sighting, observer, neighbor, and regional queries read the normalized retention-bounded MQTT history through the shared public query service instead of the removed bespoke V1 representations. API reads perform no network I/O.

## MeshCore.io queue

Ingress deduplication and insertion are transactional and bounded. The configured short deduplication window is independent of the 24-hour pending-ingress retention, so backlog or restart does not discard accepted work after a few seconds. Capacity and expiry drops are counted. The local ingress loop transactionally marks one row as processing, which fences capacity and expiry cleanup until acknowledgement or retry. Valid advert admission checks accepted timestamps, minimum re-upload interval, cooldown, active-node uniqueness, deduplication key, and capacity in one immediate transaction. Workers transactionally select the oldest eligible pending/retry job and increment its durable attempt count before HTTP work.

On startup, every `processing` job is returned to `retry`, because no foreign process can still own it. Unexpected poster or worker exceptions also return the claimed row to retry in the same running process until the configured attempt limit, then drop it. Success and permanent failure transition state, update counters, append history, trim history/jobs, and update accepted/map state atomically. This is local at-least-once HTTP processing, not distributed exactly-once delivery.

## Durable and local state

Durable state is listed in the schema table above. Observer history and unexpired neighbors hydrate the process-local dashboard model before listeners open; stale active flags are cleared because sockets never survive restart. Node adverts and per-region hearings are durable but are queried only while their seven-day expirations are active. Process-local state is limited to active connections, observer ownership, subscriber generations, rolling metrics, rate limits, active upload count, outbound MQTT connection status, serialized recorder work, and current HTTP requests. The dashboard retains a one-element `brokers` array for response compatibility, not as a scaling abstraction. A target `/neighbors` forwarding attempt records its durable clear deadline before publishing; expired clears survive disconnect or restart and are retried until the target accepts the clear.

## Operations

The bind mount is the only way to select host storage. The in-container destination cannot change. The entrypoint changes only the fixed directory's ownership/mode and never recursively changes mounted files.

For consistent backups, stop the container and copy the complete mounted directory. Online copies must use a database-aware procedure. Backups needed across an upgrade must be taken before the new broker starts because incompatible storage is deleted automatically. No old installation import, schema upgrade, migration runner, or rollback mechanism exists.

The ordinary HTTP surface on the shared listener has no built-in authentication and should be network-restricted or placed behind an authenticated reverse proxy when its operational data is sensitive. It exposes subscriber connection/subscription metadata, observer and neighbor state, protection events, integration state, and verified node advert packets/region hearings. Browser map clients contact hard-coded OpenStreetMap or CARTO tile providers and display provider attribution; no API key is embedded. MeshCore.io and target MQTT are optional outbound integrations. Configured region metadata and the bundled Sweden geofence require no runtime network request.
