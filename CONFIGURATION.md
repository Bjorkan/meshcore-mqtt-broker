# Configuration

The broker reads one `config.yaml` document at startup. Unknown YAML settings are ignored. There is no database and no `DATABASE_*` configuration.

| Setting                       | Purpose                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `mqtt.ws_port`                | MQTT-over-WebSocket bind port                                   |
| `mqtt.host`                   | WebSocket bind host                                             |
| `mqtt.ws_max_payload_bytes`   | WebSocket payload limit                                         |
| `mqtt.json_publish_max_bytes` | Normal JSON publish limit                                       |
| `auth.expected_audience`      | Required JWT audience; empty disables audience validation       |
| `auth.token_max_age_seconds`  | Max JWT age in seconds; `0` disables age enforcement            |
| `subscribers`                 | Subscriber credentials, roles, and limits                       |
| `iata.allowlist_enabled`      | Must be `true`; ingress requires a configured IATA code         |
| `iata.allow_test_ingress`     | Explicit compatibility opt-in for non-IATA `test` ingress       |
| `allowed_iata`                | Primary IATA allowlist, names, and secondary IATA mapping       |
| `storage`                     | Parsed for YAML compatibility only; the broker keeps no history |
| `decryption`                  | Parsed for YAML compatibility only; unused without history      |
| `target_mqtt`                 | Optional target forwarding (in-memory queue)                    |
| `meshcore_io`                 | Optional verified-advert upload (in-memory queue)               |
| `proxy`                       | Parsed for YAML compatibility only; IP trust lives in Traefik   |
| `healthcheck`                 | MQTT loopback healthcheck overrides                             |
| `abuse`                       | Observe-only abuse detection thresholds (never enforced)        |

Abuse detection is always observe-only logging; nothing is muted, silenced, or IP-blocked by the broker. `abuse.enforcement_enabled` is parsed for compatibility but ignored. `duplicate_threshold`, `max_topics_per_day`, `topic_history_size`, and `topic_history_window_ms` are parsed for compatibility but unused. `max_iata_changes_24h` is an observation/logging threshold only. Invalid or unlisted IATA publishes are denied with a machine-readable `PUBLISH_*` error code, not abuse mutes. IP blocking is handled by CrowdSec/Traefik in front of the broker.

`broker.node_name_cache_ttl_ms` defaults to 300 seconds; the example `config.yaml` sets 24 hours. `broker.name` controls the instance identity prefix (the id itself is fresh per process; `broker.runtime_id_file` is parsed for YAML compatibility but ignored — the stateless broker has no volume). `healthcheck.mqtt_port`, `mqtt_url`, `mqtt_topic`, `mqtt_payload`, and `mqtt_client_id` override the loopback check (defaulting to `mqtt.ws_port`, `ws://127.0.0.1:<port>`, and generated topic/payload/client id); `healthcheck.mqtt_username` + `healthcheck.mqtt_password` select the loopback subscriber (a limited `subscribers.users` account); `healthcheck.mqtt_timeout_ms` (default 10 s) and `mqtt_keepalive_seconds` (default 60 s) bound it. `subscribers.default_max_connections` is required, roles follow the subscriber allowlist, and the `docker_health` username is reserved.

The configured listener accepts MQTT WebSocket upgrades and `GET /status`. Dashboard, domain REST, OpenAPI, MCP, and browser frontend settings are not supported.

IATA means only the uppercase three-letter geographic MQTT ingress code in `meshcore/<IATA>/...`. MeshCore logical regions are neighbor scopes and are not configured by `allowed_iata`. `IATA_whitelist`, `allowed_regions`, and `secondary_region` remain accepted as legacy configuration names and map only to IATA; new configuration should use `iata.allowlist_enabled`, `allowed_iata`, and `secondary_iata`.

`test` is not an IATA code. It is denied by default with `PUBLISH_TEST_INGRESS_DISABLED`. `iata.allow_test_ingress: true` preserves publish compatibility when explicitly required.

## Observer error codes

Every denial carries a stable `code` for firmware string matching plus a human message. Auth denials arrive as CONNACK returnCode 5 with `[CODE] detail`. Publish denials arrive as the publish error and as JSON on the observer's own `meshcore/<IATA>/<OWN_KEY>/error` topic (subscribe to it at connect):

| Code                              | Meaning                           | Observer fix                                         |
| --------------------------------- | --------------------------------- | ---------------------------------------------------- |
| `AUTH_INVALID_USERNAME_FORMAT`    | Username is not `v1_<64-hex-key>` | Use `v1_<PUBLIC_KEY>` as username                    |
| `AUTH_INVALID_PUBLIC_KEY`         | Key part is not 64 hex chars      | Check the public key                                 |
| `AUTH_MISSING_TOKEN`              | Empty password                    | Sign a JWT with the observer private key             |
| `AUTH_INVALID_TOKEN`              | Bad signature                     | Re-sign the token for this key                       |
| `AUTH_INVALID_PASSWORD`           | Subscriber wrong password         | Check the subscriber password in config              |
| `AUTH_WRONG_AUDIENCE`             | `aud` mismatch                    | Re-issue the token for the broker audience           |
| `AUTH_STALE_TOKEN`                | Expired / too old                 | Re-issue a fresh token                               |
| `AUTH_SHUTTING_DOWN`              | Broker restarting                 | Retry after restart                                  |
| `AUTH_INTERNAL_ERROR`             | Broker-side failure               | Retry; contact operator if it persists               |
| `SUBSCRIBER_CONNECTION_LIMIT`     | Too many sessions                 | Close a session before opening another               |
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
| `PUBLISH_RESERVED_SUBTOPIC`       | Broker-owned subtopic             | Don't publish to `internal`/`serial/*`/`error`       |
| `PUBLISH_SERIAL_RESPONSE_INVALID` | Bad serial JWT shape              | Send header.payload.signature base64url              |
| `PUBLISH_PAYLOAD_TOO_LARGE`       | Over size limit                   | Shrink the payload                                   |
| `PUBLISH_INVALID_JSON`            | Bad JSON/JWT shape                | Send valid JSON with matching `origin_id`            |
| `PUBLISH_ORIGIN_MISSING`          | No `origin_id`                    | Include `origin_id`                                  |
| `PUBLISH_ORIGIN_MISMATCH`         | `origin_id` != auth key           | Set `origin_id` to the authenticated key             |
| `PUBLISH_UNKNOWN_CLIENT`          | Not authenticated                 | Authenticate first                                   |
| `PUBLISH_INTERNAL_ERROR`          | Broker-side failure               | Retry; contact operator if it persists               |
