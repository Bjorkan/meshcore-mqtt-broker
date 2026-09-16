# Migration Notes

## Stateless broker (PostgreSQL removed)

The PostgreSQL backend, MQTT history ingest pipeline, channel decryption at ingest, node-advert recording, file/DB-backed Aedes persistence, and IP blocking/rate limiting have been removed. The broker keeps all MQTT and queue state in process memory (Aedes default persistence) and resets it on restart. Retained `/neighbors` still expire after 48 hours in MQTT. The MeshCore.io upload queue and target-MQTT forwarding queue are in-memory with the same admission, dedup, cooldown, retry, and logging semantics but no durability across restarts.

What this means when upgrading from a database-backed release:

- Remove all `DATABASE_*` environment variables, secrets, and the `postgres/` provisioning tree; there is nothing to migrate and no data to preserve.
- `storage.*`, `decryption.*`, and `proxy.*` YAML sections are still parsed for compatibility but ignored. `abuse.enforcement_enabled` is parsed but ignored: detection is always observe-only, and CrowdSec/Traefik own IP blocking.
- `GET /status` now returns `{ status: "ok", storage: "stateless" }` instead of schema/generation metadata.
- `mc-mqtt status` prints the broker identity and stateless mode. Observer/abuse/reset commands explain that state is process-local or a no-op.
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
