# Architecture

## Runtime

The supported deployment is exactly one container and one long-lived Node.js broker process. That process owns one Aedes instance, its local message emitter, the WebSocket listener, dashboard/API listener, optional target bridge, optional MeshCore.io workers, and one managed embedded Turso connection. Docker healthchecks and operator-invoked CLI commands run as short-lived auxiliary Node.js processes; they never host another broker or worker replica.

```text
MeshCore observers and subscribers
                |
       MQTT over WebSocket :8883
                |
     one Node.js / Aedes process
       |        |          |
 local emitter  |     target MQTT (optional)
                |
       dashboard/API :8080
                |
 embedded file-backed Turso
 /data/meshcore-mqtt-broker/meshcore-mqtt-broker.db
```

There is no required external/cloud state service, external database, broker coordination, ownership service, election, failover, replica, or horizontal-scaling mode. Optional target MQTT, MeshCore.io, browser map tiles, and the fixed HTTP redirect are outbound integrations rather than architecture dependencies. The local Aedes emitter is sufficient because no other broker process participates.

## Startup and shutdown

`src/database.ts` is the sole source-code authority for the production directory and filename. Startup recursively creates the fixed directory, verifies that it is a readable/writable directory, opens Turso, initializes and validates the exact schema, and probes it before Aedes or either HTTP listener starts. An unusable or incompatible database produces a Swedish fatal error and a non-zero process exit.

The direct idempotent initializer uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` only for an empty database. An existing marked database is validated before any DDL runs, including every required table/column and a fingerprint of table constraints and indexes. It is not a migration or repair system. Health and CLI processes use the non-initializing validation path.

SIGTERM/SIGINT stops new observer ownership, terminates WebSockets, closes both HTTP listeners, closes Aedes while local consumers remain available for final publish events, drains MeshCore.io and target-forwarding work, releases process-local state, and asynchronously closes Turso after tracked database operations settle.

## Modules

- `src/database.ts`: fixed path, storage checks, connection ownership, current schema, compatibility validation, health probe.
- `src/aedes-persistence-turso.ts`: retained packets, subscriptions, outgoing/incoming QoS state, wills, streams, wildcard matching, bounded cleanup.
- `src/state-store.ts`: relational observer, trust, denial, and dashboard state plus process-local subscriber sessions and metrics.
- `src/server.ts`: authentication, authorization, single local observer owner, listeners, dashboard wiring, graceful shutdown.
- `src/config.ts`: read-only YAML loading, validation, public branding, and typed region configuration.
- `src/region-registry.ts`: synchronous configuration-backed primary/secondary region lookup with no I/O.
- `src/meshcore-io-runtime.ts`: local durable ingress and upload queue, recovery, retries, history, map state.
- `src/dashboard.ts`: local dashboard snapshot and public observer API.
- `src/healthcheck.ts`: real MQTT loopback plus bounded Turso query.
- `src/cli.ts`: fixed-database status, observer listing, abuse operations, and explicit application reset.

## Schema

Columns ending in `_ms` and dashboard/runtime timestamps use Unix milliseconds. The `advertTimestamp` inside `meshcore_io_jobs.job_json` and `meshcore_io_node_state.accepted_advert_timestamp` store MeshCore advert timestamps in seconds.

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
| `meshcore_io_ingress`        | Bounded accepted MQTT ingress awaiting parsing                               | identity/order and expiration indexes                                             |
| `meshcore_io_ingress_dedup`  | Exact topic/payload dedup window independent of ingress consumption          | digest PK, expiration index                                                       |
| `meshcore_io_observer_radio` | Validated radio parameters                                                   | observer PK, expiration index; 24-hour retention                                  |
| `meshcore_io_jobs`           | Pending, processing, retry, completed, and dropped jobs                      | unique request, partial unique active node/dedup, claim/order and history indexes |
| `meshcore_io_node_state`     | Cooldown and accepted advert timestamp                                       | node PK, expiration index                                                         |
| `meshcore_io_history`        | Upload/drop history                                                          | deterministic order; newest 100 retained                                          |
| `meshcore_io_map`            | Latest accepted mapped advert per node                                       | node PK, time index; seven-day retention                                          |
| `meshcore_io_stats`          | Durable integration totals and latest error                                  | singleton primary key                                                             |

Externally controlled values are bound parameters. Dynamic identifiers exist only in fixed internal cleanup table lists. Atomic admission, claim, retry transition, completion, drop, observer timestamp ordering, observer snapshot replacement, and reset operations use `transactionAsync()` and its dedicated transaction handle. The official driver serializes access on the managed connection; experimental multi-process WAL permits CLI access alongside the broker.

## Aedes persistence

The adapter implements every operation used by Aedes 1.1.1 and the persistence contract: literal async `setup`, retained insert/replace/delete, exact and MQTT wildcard streams, subscription add/remove/restore/topic lookup, offline counts, cleanup, outgoing singular/combined enqueue, replay/update/acknowledgement, incoming QoS 2 operations, wills, client listing, cleanup, and destroy. Complete streams use bounded keyset-paged queries rather than truncating contract results.

Packets are serialized as binary Node values so Buffers and Aedes metadata round-trip; transient function-valued Aedes callbacks are excluded. Retained combination streams preserve Aedes' per-filter behavior when filters overlap. Offline subscription matches collapse overlapping filters to one effective delivery per client at the highest matching QoS. Clean sessions atomically remove subscriptions and both QoS queues. Only the exact `meshcore/{region}/{key}/neighbors` subtopic receives a durable 48-hour expiration. The operator-facing instance ID remains stable while `broker.runtime_id_file` persists; the default `/tmp/mc-mqtt-broker-id` survives only for the life of the container. Each Aedes process also receives a unique runtime identity so outgoing packet counters and crash-surviving wills cannot collide across restart. Communication methods that only connected separate broker processes were deliberately removed because the architecture has one broker and uses Aedes' in-process emitter.

## Ownership and sessions

The process stores one current `MeshAedesClient` per observer public key. Successful newer authentication waits for any in-flight authorization by the current connection, then replaces and closes it. Publish authorization and target forwarding compare object identity with this map. Disconnect removes ownership only if the disconnecting object is still current, preventing stale callbacks from deleting a replacement.

Subscriber connection records and subscription summaries are process-local. Registration replaces the same MQTT client ID atomically within the event loop and returns a UUID generation. Subscription updates and disconnect cleanup require that generation. Restart intentionally clears all active sessions.

## Configuration and regions

Configuration is parsed once before listeners open. `IATA_whitelist` defaults to false; in that state `allowed_regions` is not semantically parsed. Publishes accept the case-insensitive `test` region or exactly three uppercase ASCII letters other than the reserved placeholder `XXX`. When enabled, `src/config.ts` strictly creates primary and secondary maps. `RegionRegistry` is synchronous and performs no HTTP request or separate filesystem read. Invalid relationships therefore fail startup instead of creating runtime reconciliation branches.

The dashboard HTML bootstrap receives a deliberately constructed `PublicDashboardConfig` containing only validated branding and whitelist status. Script-element JSON escapes HTML-significant characters. The unauthenticated `/api/dashboard` route separately exposes operational observer, neighbor, subscriber connection/subscription, protection, and integration state. Operational snapshots expose canonical `regionLookup`; deprecated `countyLookup` remains only until a documented breaking release and contains no source metadata.

## MeshCore.io queue

Ingress deduplication and insertion are transactional and bounded. The configured short deduplication window is independent of the 24-hour pending-ingress retention, so backlog or restart does not discard accepted work after a few seconds. Capacity and expiry drops are counted. The local ingress loop transactionally marks one row as processing, which fences capacity and expiry cleanup until acknowledgement or retry. Valid advert admission checks accepted timestamps, minimum re-upload interval, cooldown, active-node uniqueness, deduplication key, and capacity in one immediate transaction. Workers transactionally select the oldest eligible pending/retry job and increment its durable attempt count before HTTP work.

On startup, every `processing` job is returned to `retry`, because no foreign process can still own it. Unexpected poster or worker exceptions also return the claimed row to retry in the same running process until the configured attempt limit, then drop it. Success and permanent failure transition state, update counters, append history, trim history/jobs, and update accepted/map state atomically. This is local at-least-once HTTP processing, not distributed exactly-once delivery.

## Durable and local state

Durable state is listed in the schema table above. Observer history and unexpired neighbors hydrate the process-local dashboard model before listeners open; stale active flags are cleared because sockets never survive restart. Process-local state is limited to active connections, observer ownership, subscriber generations, rolling metrics, rate limits, active upload count, outbound MQTT connection status, and current HTTP requests. The dashboard retains a one-element `brokers` array for response compatibility, not as a scaling abstraction. A target `/neighbors` forwarding attempt records its durable clear deadline before publishing; expired clears survive disconnect or restart and are retried until the target accepts the clear.

## Operations

The bind mount is the only way to select host storage. The in-container destination cannot change. The entrypoint changes only the fixed directory's ownership/mode and never recursively changes mounted files.

For consistent backups, stop the container and copy the complete mounted directory. Online copies must use a database-aware procedure. No old installation import, schema upgrade, migration runner, or rollback mechanism exists.

The dashboard/API listener has no built-in authentication and should be network-restricted or placed behind an authenticated reverse proxy when its operational data is sensitive. Browser map clients contact hard-coded OpenStreetMap or CARTO tile providers and display provider attribution; no API key is embedded. MeshCore.io and target MQTT are optional outbound integrations. Non-WebSocket HTTP requests on the MQTT port receive a request-independent hard-coded redirect to YouTube. Default startup performs no operator-specific region-data request.
