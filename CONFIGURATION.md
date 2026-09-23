# Configuration

The broker reads one `config.yaml` document at startup. Unknown YAML settings are ignored. Removed history/decryption/proxy settings and abuse settings have no loaders or validation; see [MIGRATION.md](MIGRATION.md) for the removal list. There is no database and no `DATABASE_*` configuration. The only mount is the read-only config file (`./config.yaml:/run/configs/meshcore-mqtt-broker-config.yaml:ro`); there are no volumes and nothing is persisted.

| Setting                       | Purpose                                                        |
| ----------------------------- | -------------------------------------------------------------- |
| `mqtt.ws_port`                | MQTT-over-WebSocket bind port                                  |
| `mqtt.host`                   | WebSocket bind host                                            |
| `mqtt.ws_max_payload_bytes`   | WebSocket payload limit                                        |
| `mqtt.json_publish_max_bytes` | Normal JSON publish limit                                      |
| `auth.expected_audience`      | Required JWT audience; empty disables audience validation      |
| `auth.token_max_age_seconds`  | Max JWT `iat` age in seconds; `0` disables only the `iat` cap  |
| `subscribers`                 | Subscriber credentials, roles, and limits                      |
| `iata.allowlist_enabled`      | Must be `true`; ingress requires a configured IATA code        |
| `iata.allow_test_ingress`     | Explicit compatibility opt-in for non-IATA `test` ingress      |
| `allowed_iata`                | Primary IATA allowlist, names, and secondary IATA mapping      |
| `target_mqtt`                 | Optional target forwarding (in-memory queue)                   |
| `meshcore_io`                 | Optional verified-advert upload (in-memory queue)              |
| `healthcheck`                 | HTTP `/status` healthcheck overrides (`http_port`, `http_url`) |

The broker has no abuse scoring or observation history. Invalid or unlisted IATA publishes are denied with a machine-readable `PUBLISH_*` error code. IP blocking is handled by CrowdSec/Traefik in front of the broker.

`broker.name` is the display prefix for the per-process broker identity (fresh `<Name>-XXXX` per boot, shared by `/status`, logs, target `clientId`, and `$SYS` quarantine topics; rotates on restart by design). `healthcheck.http_port` / `http_url` override the Docker HEALTHCHECK probe (defaulting to `mqtt.ws_port` and `http://127.0.0.1:<port>/status` with the exact `/status` path); `healthcheck.http_timeout_ms` (default 8 s, max 10 s so Docker never kills the probe first) bounds it. `subscribers.default_max_connections` is required and counts live sockets per username (not MQTT clientIds, which two sockets may share); `subscribers.users` names must not use the `v1_` observer prefix (a `v1_<key>` subscriber would shadow that observer's JWT auth), and duplicates are rejected case-insensitively. Subscriber connection slots are released on disconnect, close, and protocol errors so limits never leak until restart.

The configured listener accepts MQTT WebSocket upgrades and `GET /status`. `GET /status` returns `{ status: "ok", storage: "stateless", instanceId, uptimeMs, observers, target: { enabled, connected, droppedMessages, successfulMessages }, meshcoreIo: { enabled, ingressPending, jobsPending, jobsProcessing, jobsRetrying, dedupEntries, observerEntries, nodeEntries, completedUploads, droppedUploads } }` with `Cache-Control: no-store`. `instanceId` rotates on every restart (single-broker design, no coordination to preserve). Dashboard, domain REST, OpenAPI, MCP, and browser frontend settings are not supported.

IATA means only the uppercase three-letter geographic MQTT ingress code in `meshcore/<IATA>/...`. MeshCore logical regions are neighbor scopes and are not configured by `allowed_iata`. `IATA_whitelist`, `allowed_regions`, and `secondary_region` remain accepted as legacy configuration names and map only to IATA; new configuration should use `iata.allowlist_enabled`, `allowed_iata`, and `secondary_iata`.

`test` is not an IATA code. It is denied by default with `PUBLISH_TEST_INGRESS_DISABLED`. `iata.allow_test_ingress: true` preserves publish compatibility when explicitly required. `test` denials route to `meshcore/test/<OWN_KEY>/error`; `test` ingress is never uploaded to MeshCore.io. Accepted exact `neighbors` messages are always retained, including on opted-in `test` ingress.

## Retain policy

Every accepted exact `meshcore/<IATA>/<OWN_KEY>/neighbors` publish is retained regardless of the client's retain flag, including opted-in `test` ingress, locally and on the target. All other client publishes are nonretained. Neighbor expiry is scheduled for 48 hours using process-local tracking (10 000 entries). Capacity eviction clears the oldest retained value before reusing its tracking slot; failed clears preserve the existing expiry obligation. Target clearing requires connectivity, and target deadlines reset on broker restart.

## Subscriber roles

| Topic                                          | `ADMIN` (1) | `FULL_ACCESS` (2) | `LIMITED` (3)    |
| ---------------------------------------------- | ----------- | ----------------- | ---------------- |
| Public `meshcore/#` / `meshcore/...`           | allow, full | allow, full       | allow, stripped  |
| `meshcore/.../internal`, `.../serial/*` direct | allow       | deny              | deny             |
| Other observers' `/error`                      | allow + fwd | deny, fwd `null`  | deny, fwd `null` |
| `heartbeat/` (exact, trailing slash)           | allow       | allow             | allow            |
| `$SYS/...`                                     | allow       | deny, fwd `null`  | deny, fwd `null` |

`LIMITED` forward stripping (exact canonical subtopics, case-insensitive): `status` drops `stats`/`model`/`firmware_version`; `packets` drops `snr`/`SNR`/`rssi`/`RSSI`/`score` (any case); `neighbors[]` drops per-neighbor `snr`/`SNR`/`rssi`/`score` (any case). A role-less subscriber is treated as `LIMITED` (fail closed). Publishers (observers) are publish-only: they may subscribe only to their own `/error` (any IATA, including `XXX` — the channel that carries denial codes) and their own `serial/commands` when their IATA is allowed (denied with `PUBLISH_UNKNOWN_IATA` but WITHOUT closing, so the error channel stays alive).

The heartbeat topic is exactly `heartbeat/` (with trailing slash). `heartbeat` without slash and `heartbeat/#` wildcards are denied. `GET /status` reports the live broker identity, uptime, observer count, and integration queues; no administrative CLI is installed.

## Observer error codes

Auth denials arrive as MQTT 3.1.1 CONNACK returnCode 5 ("not authorized", the only 3.1.1 code that fits). The `[CODE] detail` text CANNOT travel on the wire — MQTT 3.1.1 CONNACK has no reason string, so firmware only ever sees `5`. Codes are broker-log only, and there is no pre-auth channel to the client (no subscription exists yet). Publish denials arrive as the publish error and as JSON on the observer's own `meshcore/<IATA>/<OWN_KEY>/error` topic (subscribe to it at connect; also subscribe `meshcore/XXX/<OWN_KEY>/error` until the first successful publish reveals the working IATA):

| Code                              | Meaning                           | Observer fix                                         |
| --------------------------------- | --------------------------------- | ---------------------------------------------------- |
| `AUTH_INVALID_USERNAME_FORMAT`    | Username is not `v1_<64-hex-key>` | Use `v1_<PUBLIC_KEY>` as username                    |
| `AUTH_INVALID_PUBLIC_KEY`         | Key part is not 64 hex chars      | Check the public key                                 |
| `AUTH_MISSING_TOKEN`              | Empty password                    | Sign a JWT with the observer private key             |
| `AUTH_INVALID_TOKEN`              | Bad signature                     | Re-sign the token for this key                       |
| `AUTH_INVALID_PASSWORD`           | Subscriber wrong password         | Check the subscriber password in config              |
| `AUTH_WRONG_AUDIENCE`             | `aud` mismatch                    | Re-issue the token for the broker audience           |
| `AUTH_STALE_TOKEN`                | Expired / too old / future clock  | Re-issue a fresh token with a correct clock          |
| `AUTH_SHUTTING_DOWN`              | Broker restarting                 | Retry after restart                                  |
| `AUTH_INTERNAL_ERROR`             | Broker-side failure               | Retry; contact operator if it persists               |
| `SUBSCRIBER_CONNECTION_LIMIT`     | Too many sockets                  | Close a socket before opening another                |
| `PUBLISH_NOT_MESHCORE_TOPIC`      | Topic outside `meshcore/`         | Publish under `meshcore/<IATA>/<OWN_KEY>/...`        |
| `PUBLISH_BAD_TOPIC_SHAPE`         | Bad shape (incl. non-64-hex key)  | Use `meshcore/<IATA>/<64-hex-key>/<subtopic>`        |
| `PUBLISH_PLACEHOLDER_IATA`        | `XXX` placeholder                 | Configure the observer's real three-letter IATA code |
| `PUBLISH_TEST_INGRESS_DISABLED`   | `test` not enabled                | Use a real IATA code                                 |
| `PUBLISH_INVALID_IATA_FORMAT`     | Not 3 uppercase letters           | Set the observer IATA to an allowed code, uppercased |
| `PUBLISH_SECONDARY_IATA`          | Secondary code used               | Publish under the named primary code                 |
| `PUBLISH_UNKNOWN_IATA`            | Code not allowlisted              | Use a listed code                                    |
| `PUBLISH_KEY_MISMATCH`            | Topic key != auth key             | Publish under the authenticated key                  |
| `PUBLISH_STALE_CONNECTION`        | Newer connection took over        | Reconnect to take over                               |
| `PUBLISH_STALE_STATUS`            | Older device timestamp            | Check the observer clock                             |
| `PUBLISH_RESERVED_SUBTOPIC`       | Broker-owned subtopic             | Don't publish to `internal`/`serial/*`/`error`/`raw` |
| `PUBLISH_SERIAL_RESPONSE_INVALID` | Bad serial JWT shape              | Send header.payload.signature base64url              |
| `PUBLISH_PAYLOAD_TOO_LARGE`       | Over size limit                   | Shrink the payload                                   |
| `PUBLISH_INVALID_JSON`            | Not a JSON object                 | Send a JSON object with matching `origin_id`         |
| `PUBLISH_ORIGIN_MISSING`          | Missing/empty `origin_id`         | Include `origin_id`                                  |
| `PUBLISH_ORIGIN_MISMATCH`         | `origin_id` != auth key (or type) | Set string `origin_id` to the authenticated key      |
| `PUBLISH_UNKNOWN_CLIENT`          | Not authenticated                 | Authenticate first                                   |
| `PUBLISH_INTERNAL_ERROR`          | Broker-side failure               | Retry; contact operator if it persists               |

Token policy: `exp` is always enforced (part of the token). `auth.token_max_age_seconds` additionally caps `iat` age; `0` disables only the `iat` cap, never `exp`. Tokens with `iat` more than 5 minutes in the future are rejected (`AUTH_STALE_TOKEN`, broken observer clock). An expired `exp` reports `AUTH_STALE_TOKEN` (not `AUTH_INVALID_TOKEN`) even though the decoder only returns `null`. Reserved subtopics (`error`, `internal`, `serial` except `serial/responses`, `raw` and anything under it) are matched case-insensitively; the deprecated `/raw` subtopic and `raw/*` are always discarded. Admin `serial/commands` publishes still require an allowed IATA. The stale-status guard uses its own 48 h TTL (measured from broker receipt time); equal timestamps are accepted ("older", not "older-or-equal"). Stale publish connections are closed after the code is flushed to `/error` (400 ms); stale subscribe attempts are denied WITHOUT closing so the observer keeps its error channel. The per-publish `internal` JWT fan-out was removed (write amplification, no consumer). Close policy: `XXX`, bad IATA format, key mismatch, and stale connection close the transport after the `/error` flush; `test`-disabled, secondary, unknown IATA, and reserved subtopics do not.
