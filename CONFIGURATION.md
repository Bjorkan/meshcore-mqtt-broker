# Configuration

The broker reads one `config.yaml` document and PostgreSQL `DATABASE_*` environment variables at startup. Unknown YAML settings are ignored.

| Setting                       | Purpose                                                           |
| ----------------------------- | ----------------------------------------------------------------- |
| `mqtt.ws_port`                | MQTT-over-WebSocket bind port                                     |
| `mqtt.host`                   | WebSocket bind host                                               |
| `mqtt.ws_max_payload_bytes`   | WebSocket payload limit                                           |
| `mqtt.json_publish_max_bytes` | Normal JSON publish limit                                         |
| `auth.expected_audience`      | Required JWT audience; empty disables audience validation         |
| `auth.token_max_age_seconds`  | Max JWT age in seconds; `0` disables age enforcement              |
| `subscribers`                 | Subscriber credentials, roles, and limits                         |
| `iata.allowlist_enabled`      | Must be `true`; normalized ingest requires a configured IATA code |
| `iata.allow_test_ingress`     | Explicit compatibility opt-in for non-IATA `test` ingress         |
| `allowed_iata`                | Primary IATA allowlist, names, and secondary IATA mapping         |
| `storage`                     | Split raw/normalized history retention and cleanup                |
| `decryption`                  | Optional channel decryption at ingest                             |
| `target_mqtt`                 | Optional target forwarding                                        |
| `meshcore_io`                 | Optional verified-advert upload                                   |
| `proxy`                       | Trusted proxy IP handling                                         |
| `healthcheck`                 | MQTT loopback healthcheck overrides                               |
| `abuse`                       | Abuse detection and enforcement policy                            |

Storage retention settings:

- `storage.raw_retention_days` (default 30) bounds the raw MQTT payload journal. Legacy `storage.retention_days` is accepted as its fallback.
- `storage.normalized_retention_days` defaults to `0`, which keeps normalized history indefinitely. A positive value enables independent expiry of normalized facts while preserving compact provenance and current identities/state.
- `storage.failed_retention_days` (default 90) bounds failed raw payloads that already carry `processing_errors` markers. Provenance and error markers survive; only the raw payload row expires, so a failure can never become silently retryable.
- `storage.cleanup_interval_minutes` and `storage.cleanup_batch_size` bound cleanup cadence and transactions.
- `storage.max_pending_events` (default `0`, disabled) denies new publishes with a storage-backpressure error once that many raw events are unprocessed (`pending`/`processing`/`failed`). Set it to bound disk use when normalization falls behind.

Abuse detection is always observed and logged; enforcement (mutes/silencing) only applies when `abuse.enforcement_enabled: true` (default `false`). `duplicate_threshold`, `max_topics_per_day`, `topic_history_size`, and `topic_history_window_ms` are parsed for compatibility but not currently enforced. `max_iata_changes_24h` is an observation/logging threshold only and never denies or mutes by itself; invalid or unlisted IATA publishes are denied events, not abuse mutes.

The configured listener accepts MQTT WebSocket upgrades and `GET /status`. Dashboard, domain REST, OpenAPI, MCP, and browser frontend settings are not supported.

`DATABASE_MIGRATION_TIMEOUT_MS` bounds the complete known startup migration chain and any subsequent canonical reset. It defaults to `300000` milliseconds and must be between `1000` and `600000`. The database connection remains open for that maintenance window. Known migration failures retain the availability-first one-reset behavior; infrastructure, authentication, permission, disk, and other infrastructure failures never trigger reset.

IATA means only the uppercase three-letter geographic MQTT ingress code in `meshcore/<IATA>/...`. MeshCore logical regions are neighbor scopes and are not configured by `allowed_iata`. `IATA_whitelist`, `allowed_regions`, and `secondary_region` remain accepted as legacy configuration names and map only to IATA; new configuration should use `iata.allowlist_enabled`, `allowed_iata`, and `secondary_iata`.

`test` is not an IATA code. It is denied by default. `iata.allow_test_ingress: true` preserves publish compatibility when explicitly required, but normalized MQTT history still accepts only uppercase three-letter IATA codes.

Channel keys are secrets. Decrypted content is stored in PostgreSQL; restrict database and configuration-file access accordingly.
