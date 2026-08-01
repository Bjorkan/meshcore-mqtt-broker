# Configuration

The broker reads `config.yaml` once at startup. In Docker it is normally mounted read-only at `/run/configs/meshcore-mqtt-broker-config.yaml`. Restart the process after changes. YAML syntax and active settings are validated before listeners start.

## Core settings

| Setting                         | Required/default | Validation and purpose                                        |
| ------------------------------- | ---------------- | ------------------------------------------------------------- |
| `mqtt.ws_port`                  | required         | Integer `0..65535`; MQTT WebSocket listener                   |
| `mqtt.host`                     | required         | Non-empty bind host                                           |
| `mqtt.ws_max_payload_bytes`     | `65536`          | Positive integer                                              |
| `mqtt.json_publish_max_bytes`   | `8192`           | Positive integer                                              |
| `dashboard.port`                | `8080`           | Integer `0..65535`                                            |
| `broker.name`                   | `Broker`         | Stable operator-facing instance-name prefix                   |
| `broker.runtime_id_file`        | unset            | Optional runtime identity file used by CLI/health processes   |
| `broker.node_name_cache_ttl_ms` | `300000`         | Positive integer                                              |
| `auth.expected_audience`        | required         | JWT audience; exact empty string disables audience validation |

Production storage is not configurable. It is always `/data/meshcore-mqtt-broker/meshcore-mqtt-broker.db`.

## Branding

```yaml
branding:
  operator_name: MeshCore MQTT
  dashboard_title: MeshCore MQTT Broker
  dashboard_subtitle: Operations dashboard
  website_url: ""
```

| Setting                       | Default                | Validation                                                      |
| ----------------------------- | ---------------------- | --------------------------------------------------------------- |
| `branding.operator_name`      | `MeshCore MQTT`        | Non-empty string, at most 80 characters, no control characters  |
| `branding.dashboard_title`    | `MeshCore MQTT Broker` | Non-empty string, at most 120 characters, no control characters |
| `branding.dashboard_subtitle` | `Operations dashboard` | Non-empty string, at most 160 characters, no control characters |
| `branding.website_url`        | empty                  | Empty or an `http:`/`https:` URL, at most 2048 characters       |

Only these values and `IATA_whitelist` status are embedded into the browser dashboard. Subscriber, target MQTT, database, JWT, and other private settings are not public dashboard configuration.

## Regions

`IATA_whitelist` defaults to `false`. When false, every otherwise valid three-uppercase-letter region is accepted, `allowed_regions` is ignored without semantic validation, and no configured alias correction occurs. The protocol's existing case-insensitive `test` region remains separate.

When `IATA_whitelist: true`, only top-level `allowed_regions` entries are accepted:

```yaml
IATA_whitelist: true

allowed_regions:
  MMX:
    friendly_name: Malmö Sturup och södra Skåne
    secondary_region: AGH, KID
  STO:
    friendly_name: Stockholmsområdet
    secondary_region: ARN, BMA
```

Top-level keys are allowed primary regions. `secondary_region` is one comma-separated string on one line. Its values are known but disallowed alternatives and resolve to their containing primary. Friendly names exist only on primary entries.

Active whitelist validation requires:

- a non-empty list or object;
- codes that normalize to exactly three ASCII letters;
- no duplicate normalized primary or secondary code;
- each secondary under exactly one primary;
- no secondary that is also a top-level primary;
- `friendly_name` to be non-empty, no more than 120 characters, and free of control characters;
- `secondary_region` to be a string with no malformed or empty comma-separated item.

Compatibility forms remain supported when whitelisting is explicitly enabled:

```yaml
allowed_regions:
  - AGH
  - MMX
```

```yaml
allowed_regions:
  AGH:
    friendly_name: Ängelholm/Helsingborg och nordvästra Skåne
  MMX:
    friendly_name: Malmö Sturup och södra Skåne
```

## Subscribers

`subscribers.default_max_connections` is a required positive integer. `subscribers.users` is a list of unique objects with required non-empty `username` and `password`, optional role `1`, `2`, or `3`, and optional positive `max_connections`. The internal Docker health username is reserved.

## Target MQTT

| Setting                           | Default        | Validation                           |
| --------------------------------- | -------------- | ------------------------------------ |
| `target_mqtt.url`                 | empty/disabled | Target MQTT URL                      |
| `target_mqtt.username`            | empty          | Target credential                    |
| `target_mqtt.password`            | empty          | Target credential                    |
| `target_mqtt.reject_unauthorized` | `true`         | Boolean TLS certificate verification |
| `target_mqtt.reconnect_period_ms` | `5000`         | Integer `0..300000`                  |
| `target_mqtt.connect_timeout_ms`  | `30000`        | Integer `1000..300000`               |

## MeshCore.io

| Setting                            | Default                  | Validation             |
| ---------------------------------- | ------------------------ | ---------------------- |
| `meshcore_io.enabled`              | `false`                  | Explicit opt-in        |
| `meshcore_io.api_url`              | MeshCore.io uploader URL | HTTP target            |
| `meshcore_io.dry_run`              | `false`                  | Boolean                |
| `meshcore_io.min_reupload_seconds` | `3600`                   | Integer `0..86400`     |
| `meshcore_io.request_timeout_ms`   | `10000`                  | Integer `1000..120000` |
| `meshcore_io.workers`              | `1`                      | Integer `1..32`        |
| `meshcore_io.max_queued_uploads`   | `250`                    | Integer `1..100000`    |
| `meshcore_io.attempts`             | `3`                      | Integer `1..100`       |
| `meshcore_io.retry_delay_ms`       | `5000`                   | Integer `0..300000`    |
| `meshcore_io.ingress_dedup_ms`     | `10000`                  | Integer `1000..300000` |

## Proxy and healthcheck

`proxy.trust_proxy` defaults to false. `proxy.trusted_proxy_cidrs` is a comma-separated CIDR list used only when proxy trust is enabled.

Healthcheck settings are `mqtt_timeout_ms` (default `10000`, `1000..300000`), `mqtt_keepalive_seconds` (default `60`, `5..3600`), and optional `mqtt_port`, `mqtt_url`, `mqtt_client_id`, `mqtt_topic`, and `mqtt_payload` overrides for the internal loopback check.

## Abuse protection

The `abuse` section controls duplicate windows, token-bucket rate limits, packet size, daily topic count, anomaly thresholds, IATA-change history, topic history, and enforcement. The shipped [`config.yaml`](config.yaml) documents every key. Count and duration values must be positive, `duplicate_rate_threshold` is `0..1`, and `enforcement_enabled` is required. Invalid/unlisted region publishes are denial events and do not by themselves create an abuse mute.

## Hard-coded behavior

Map providers, styles, attribution, and behavior are source-defined. Ordinary HTTP requests on the MQTT port always redirect to `https://www.youtube.com/watch?v=dQw4w9WgXcQ`. Neither behavior has a YAML or environment override.
