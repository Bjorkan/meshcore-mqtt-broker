# Configuration

The broker reads one `config.yaml` document at startup. Unknown settings are ignored. Production storage is always `/data/meshcore-mqtt-broker/meshcore-mqtt-broker.db`.

| Setting                                | Purpose                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| `mqtt.ws_port`                         | MQTT-over-WebSocket bind port                             |
| `mqtt.host`                            | WebSocket bind host                                       |
| `mqtt.ws_max_payload_bytes`            | WebSocket payload limit                                   |
| `mqtt.json_publish_max_bytes`          | Normal JSON publish limit                                 |
| `auth.expected_audience`               | Required JWT audience; empty disables audience validation |
| `subscribers`                          | Subscriber credentials, roles, and limits                 |
| `IATA_whitelist` and `allowed_regions` | Region acceptance policy                                  |
| `storage`                              | Accepted MQTT history retention and cleanup               |
| `decryption`                           | Optional channel decryption at ingest                     |
| `target_mqtt`                          | Optional target forwarding                                |
| `meshcore_io`                          | Optional verified-advert upload                           |
| `proxy`                                | Trusted proxy IP handling                                 |
| `healthcheck`                          | MQTT loopback healthcheck overrides                       |
| `abuse`                                | Abuse detection and enforcement policy                    |

The configured listener accepts MQTT WebSocket upgrades only. Dashboard, REST, OpenAPI, MCP, and browser frontend settings are not supported.

Channel keys are secrets. Decrypted content is stored locally in the embedded database; restrict database and configuration-file access accordingly.
