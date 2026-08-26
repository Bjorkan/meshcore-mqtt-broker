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
| `storage`                     | Accepted MQTT history retention and cleanup               |
| `decryption`                  | Optional channel decryption at ingest                     |
| `target_mqtt`                 | Optional target forwarding                                |
| `meshcore_io`                 | Optional verified-advert upload                           |
| `proxy`                       | Trusted proxy IP handling                                 |
| `healthcheck`                 | MQTT loopback healthcheck overrides                       |
| `abuse`                       | Abuse detection and enforcement policy                    |

The configured listener accepts MQTT WebSocket upgrades and `GET /status`. Dashboard, domain REST, OpenAPI, MCP, and browser frontend settings are not supported.

`DATABASE_MIGRATION_TIMEOUT_MS` bounds the complete known startup migration chain. It defaults to `30000` milliseconds and must be between `1000` and `300000`. A migration failure or timeout causes one availability-first application-database reset; infrastructure, authentication, and permission failures do not.

IATA means only the uppercase three-letter geographic MQTT ingress code in `meshcore/<IATA>/...`. MeshCore logical regions are neighbor scopes and are not configured by `allowed_iata`. `IATA_whitelist`, `allowed_regions`, and `secondary_region` remain accepted as legacy configuration names and map only to IATA; new configuration should use `iata.allowlist_enabled`, `allowed_iata`, and `secondary_iata`.

`test` is not an IATA code. It is denied by default. `iata.allow_test_ingress: true` preserves publish compatibility when explicitly required, but normalized MQTT history still accepts only uppercase three-letter IATA codes.

Channel keys are secrets. Decrypted content is stored locally in the embedded database; restrict database and configuration-file access accordingly.
