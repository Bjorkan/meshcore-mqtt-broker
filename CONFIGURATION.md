# Configuration

The broker reads one `config.yaml` document and PostgreSQL `DATABASE_*` environment variables at startup. Unknown YAML settings are ignored.

| Setting                       | Purpose                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `mqtt.ws_port`                | MQTT-over-WebSocket bind port                             |
| `mqtt.host`                   | WebSocket bind host                                       |
| `mqtt.ws_max_payload_bytes`   | WebSocket payload limit                                   |
| `mqtt.json_publish_max_bytes` | Normal JSON publish limit                                 |
| `auth.expected_audience`      | Required JWT audience; empty disables audience validation |
| `subscribers`                 | Subscriber credentials, roles, and limits                 |
| `iata.allowlist_enabled`      | Enforce the configured geographic MQTT ingress IATA codes |
| `iata.allow_test_ingress`     | Explicit compatibility opt-in for non-IATA `test` ingress |
| `allowed_iata`                | Primary IATA allowlist, names, and secondary IATA mapping |
| `storage`                     | Split raw/normalized history retention and cleanup        |
| `decryption`                  | Optional channel decryption at ingest                     |
| `target_mqtt`                 | Optional target forwarding                                |
| `meshcore_io`                 | Optional verified-advert upload                           |
| `proxy`                       | Trusted proxy IP handling                                 |
| `healthcheck`                 | MQTT loopback healthcheck overrides                       |
| `abuse`                       | Abuse detection and enforcement policy                    |

Storage retention settings:

- `storage.raw_retention_days` (default 30) bounds the raw MQTT payload journal. Legacy `storage.retention_days` is accepted as its fallback.
- `storage.normalized_retention_days` defaults to `0`, which keeps normalized history indefinitely. A positive value enables independent expiry of normalized facts while preserving compact provenance and current identities/state.
- `storage.cleanup_interval_minutes` and `storage.cleanup_batch_size` bound cleanup cadence and transactions.

The configured listener accepts MQTT WebSocket upgrades and `GET /status`. Dashboard, domain REST, OpenAPI, MCP, and browser frontend settings are not supported.

`DATABASE_MIGRATION_TIMEOUT_MS` bounds the complete known startup migration chain. It defaults to `30000` milliseconds and must be between `1000` and `300000`. Known migration failures retain the availability-first one-reset behavior; infrastructure, authentication, permission, disk, and other infrastructure failures never trigger reset.

IATA means only the uppercase three-letter geographic MQTT ingress code in `meshcore/<IATA>/...`. MeshCore logical regions are neighbor scopes and are not configured by `allowed_iata`. `IATA_whitelist`, `allowed_regions`, and `secondary_region` remain accepted as legacy configuration names and map only to IATA; new configuration should use `iata.allowlist_enabled`, `allowed_iata`, and `secondary_iata`.

`test` is not an IATA code. It is denied by default. `iata.allow_test_ingress: true` preserves publish compatibility when explicitly required, but normalized MQTT history still accepts only uppercase three-letter IATA codes.

Channel keys are secrets. Decrypted content is stored locally in the embedded database; restrict database and configuration-file access accordingly.
