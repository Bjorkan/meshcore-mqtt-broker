# Migration Notes

## Stateless broker (PostgreSQL removed)

The PostgreSQL backend, MQTT history ingest pipeline, channel decryption at ingest, node-advert recording, file/DB-backed Aedes persistence, and IP blocking/rate limiting have been removed. The broker keeps all MQTT and queue state in process memory (Aedes default persistence) and resets it on restart. Exact `/neighbors` publishes now always receive retain, even when the sender requests otherwise and on opted-in `test` ingress; other client publishes are never retained. Neighbor expiry remains scheduled for 48 hours. The MeshCore.io upload queue and target-MQTT forwarding queue are in-memory with the same admission, dedup, cooldown, retry, and logging semantics but no durability across restarts.

What this means when upgrading from a database-backed release:

- Remove all `DATABASE_*` environment variables, secrets, and the `postgres/` provisioning tree; there is nothing to migrate and no data to preserve.
- Remove `storage`, `decryption`, and `proxy` sections, plus `broker.runtime_id_file`, `abuse.enforcement_enabled`, and `abuse.duplicate_threshold`. Their unused parsers, types, and validation have been deleted; old keys are ignored like other unknown YAML settings. Detection remains observe-only, and CrowdSec/Traefik own IP blocking.
- `GET /status` now returns `{ status: "ok", storage: "stateless", instanceId, uptimeMs, observers, target, meshcoreIo }` instead of schema/generation metadata. `instanceId` rotates on restart; `meshcoreIo` now also reports `completedUploads`/`droppedUploads`. Docker HEALTHCHECK probes `GET /status` (no MQTT loopback, no credentials).
- `mc-mqtt status` prints the live broker identity and stateless mode. The placeholder `observer list`, `abuse`, and `reset` commands have been removed; unsupported commands and flags now fail. Read broker logs for abuse observations and restart the container to clear process-local state.
- Put local configuration in `config.yaml` at the repository root or current working directory. The old sibling/child `broker/config.yaml` discovery paths have been removed; Docker config mount paths are unchanged.
- The unused neighbor snapshot parser, Swedish scope-name registry, MQTT-healthcheck credential helpers, and HTTP-healthcheck aliases named after MQTT loopback have been removed. Neighbor routing, privacy filtering, and retention are unchanged.
- `bun test` runs the full suite with no database. All `db:*`, `benchmark:*`, and `test-with-postgres` scripts are gone.

## Observer error codes (new)

Denials now carry stable machine-readable codes (`OBSERVER_ERROR_CODES` in `src/server.ts`, documented in `CONFIGURATION.md`):

- Auth denials: MQTT 3.1.1 CONNACK returnCode 5 with `[CODE] detail`.
- Publish denials: the authorizePublish error plus a JSON publish (`{ code, message, topic?, iata?, at }`) to the observer's own `meshcore/<IATA>/<OWN_KEY>/error` topic on the same connection before any close. Subscribe to that topic at connect to see denials on QoS 0.

## Historical schema notes

This release removes the broker-owned dashboard, REST API, OpenAPI document, Swagger UI, MCP endpoint, and frontend assets. MQTT over WebSocket and the operational `GET /status` response share `mqtt.host` and `mqtt.ws_port`.

The deprecated MQTT `/raw` subtopic is discarded before delivery or forwarding. Publishers must place raw MeshCore bytes in `/packets` JSON instead.

New configuration uses `iata.allowlist_enabled`, `iata.allow_test_ingress`, `allowed_iata`, and `secondary_iata`. The shipped `IATA_whitelist`, `allowed_regions`, and `secondary_region` names remain read-compatible aliases that map only to IATA.

Remove `branding`, `mcp`, and `public_tool_api` configuration sections. Clients using domain HTTP routes must move to MQTT or an external service.
