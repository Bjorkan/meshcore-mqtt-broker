# Configuration

The broker reads one `config.yaml` document once at startup. In Docker it is mounted read-only at `/run/configs/meshcore-mqtt-broker-config.yaml`. For local development, resolution checks `config.yaml` and `broker/config.yaml` relative to the working directory before the Docker paths and source-relative fallbacks. Restart the process after changes. The broker validates YAML structure and settings it consumes before opening listeners. Some integration URLs and proxy CIDRs are interpreted by their consumers and may fail or be ignored at runtime; healthcheck-only overrides are loaded by the separate healthcheck process.

The YAML root must be an object. Unknown general settings are ignored. When the region whitelist is enabled, unknown fields inside `allowed_regions` entries are startup errors. Ordinary optional booleans accept `true`/`false`, `yes`/`no`, `on`/`off`, or `1`/`0`; `abuse.enforcement_enabled` specifically requires `true` or `false`. Numeric YAML scalars and numeric strings are accepted where integer/number settings are documented.

## Core settings

| Setting                         | Required/default                                 | Validation and purpose                                                                                                      |
| ------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `mqtt.ws_port`                  | required                                         | Integer `0..65535`; shared MQTT WebSocket and dashboard/API HTTP listener                                                   |
| `mqtt.host`                     | required                                         | Non-empty bind host for the shared listener                                                                                 |
| `mqtt.ws_max_payload_bytes`     | `65536`                                          | Positive integer                                                                                                            |
| `mqtt.json_publish_max_bytes`   | `8192`                                           | Normal JSON limit; `/neighbors` uses at least `10240` bytes to match the firmware buffer                                    |
| `broker.name`                   | `Broker`                                         | Stable operator-facing instance-name prefix                                                                                 |
| `broker.runtime_id_file`        | `/tmp/mc-mqtt-broker-id`                         | Identity file used by broker, target bridge, CLI, and healthcheck; configure a durable path to survive container recreation |
| `broker.node_name_cache_ttl_ms` | code fallback `300000`; shipped value `86400000` | Positive integer                                                                                                            |
| `auth.expected_audience`        | required                                         | JWT audience; exact empty string disables audience validation                                                               |

Production storage is not configurable. It is always `/data/meshcore-mqtt-broker/meshcore-mqtt-broker.db`.

MQTT WebSocket upgrades and ordinary dashboard/API HTTP requests use the same `mqtt.host` and `mqtt.ws_port` listener. The removed `dashboard.port` setting is ignored as an unknown general setting when it remains in an older YAML file. Port `0` is useful only for tests or ephemeral local runs because the operating system chooses the actual port. `broker.runtime_id_file` is not the application database; its small text value stabilizes the operator-facing broker ID shared by the runtime, target bridge, CLI, and healthcheck. The default lives in `/tmp` and is lost when the container is recreated.

## Branding

```yaml
branding:
  operator_name: MeshCore MQTT
  dashboard_title: MeshCore MQTT Broker
  dashboard_subtitle: Operations dashboard
  website_url: ""
```

| Setting                       | Default                | Validation                                                                                           |
| ----------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `branding.operator_name`      | `MeshCore MQTT`        | Non-empty string, at most 80 characters, no control characters                                       |
| `branding.dashboard_title`    | `MeshCore MQTT Broker` | Non-empty string, at most 120 characters, no control characters                                      |
| `branding.dashboard_subtitle` | `Operations dashboard` | Non-empty string, at most 160 characters, no control characters                                      |
| `branding.website_url`        | empty                  | Empty or an `http:`/`https:` URL without credentials, at most 2048 characters, no control characters |

Only these values and `IATA_whitelist` status are embedded into the dashboard HTML bootstrap. Subscriber credentials, target MQTT credentials, database settings, JWT settings, and the complete YAML document are not bootstrap configuration. Branding affects the dashboard shell, not the fixed Swagger UI title. `/api/dashboard` separately returns unauthenticated operational state, including observer, neighbor, subscriber connection/subscription, denial, and integration information.

## Regions

The shipped configuration explicitly sets `IATA_whitelist: false`. When false, publishes accept the case-insensitive `test` region or exactly three uppercase ASCII letters other than the reserved placeholder `XXX`. `allowed_regions` is ignored without semantic validation, and no configured alias correction occurs. Configurations created before this setting existed retain active whitelisting when they contain `allowed_regions`; set `IATA_whitelist: false` explicitly to disable it.

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

Top-level keys are allowed primary regions. `secondary_region` is a comma-separated YAML string. Its values are known but disallowed alternatives and resolve to their containing primary. Friendly names exist only on primary entries. A secondary publish is denied; the expected primary is recorded in dashboard/API denial metadata, while the MQTT authorization error remains generic.

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

Object keys with null/empty values are also accepted as primaries. Configured primary and secondary codes are trimmed and normalized to uppercase; region codes in MQTT topics must already be uppercase.

The shipped `config.yaml` includes an inactive Swedish operator-ready mapping so that deployment can be reproduced by enabling the whitelist. Operators may replace it. Its source and CC BY 4.0 attribution are documented in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

The nodes API has no region allowlist of its own. It records only adverts from MQTT publishes that have already passed authorization, and its ordinary `region` filter uses the normalized region from those accepted topics. The reserved API filter `SWE` is a source-defined geographic test against bundled Sweden boundary data; it is not configured through `allowed_regions` and makes no runtime network request.

## Subscribers

`subscribers.default_max_connections` is a required positive integer. `subscribers.users` is a list of unique objects with required non-empty `username` and `password`, optional role `1` (admin), `2` (full public access), or `3` (limited public access, the default), and optional positive `max_connections`. The internal `docker_health` username is reserved and receives generated process-local credentials rather than a YAML password.

## Historical storage

```yaml
storage:
  retention_days: 30
  cleanup_interval_minutes: 60
  cleanup_batch_size: 1000
  store_internal: false
  store_serial: false
```

`retention_days` defaults to `30`; `cleanup_interval_minutes` defaults to `60`; and `cleanup_batch_size` defaults to `1000`. Each must be an integer of at least `1` when explicitly configured. Invalid values stop startup with a configuration error.

Retention always uses `mqtt_events.received_at_ms` and the configuration loaded for the current process. Reducing retention makes older receipts eligible at the next cleanup; increasing it keeps remaining receipts longer. Reprocessing does not refresh receipt time. Cleanup commits expired events in configured batches and then removes unsupported packet, node, and observer identities.

`store_internal` and `store_serial` default to `false`. Leave them disabled for the public network-history contract. The embedded collector receives full accepted publisher fields directly from Aedes and requires no separate MQTT credentials. The production database path is fixed and cannot be configured here. See [`DATABASE.md`](DATABASE.md) and [`INGEST.md`](INGEST.md).

## Public MCP V2

```yaml
mcp:
  enabled: true
  path: /mcp/v2
  default_limit: 50
  max_limit: 250
```

The anonymous read-only MCP V2 endpoint is enabled by default on the existing HTTP/WebSocket listener. `path` must be exactly `/mcp/v2`; it is present to make the fixed public contract visible, not to create alternate endpoints. Limits are positive integers, `default_limit` cannot exceed `max_limit`, and `max_limit` cannot exceed 1,000. These settings do not add authentication and cannot expose generic database, file, or MQTT access. See [`MCP.md`](MCP.md).

## Public REST API V2

```yaml
public_tool_api:
  enabled: true
```

The anonymous read-only REST API served by Fastify 5 is enabled by default on the same shared listener at the fixed path `/api/v2`. `enabled` controls only the REST surface; the MCP endpoint is controlled separately by `mcp.enabled`. See [`REST_API.md`](REST_API.md).

## Channel decryption

```yaml
decryption:
  enabled: false
  hashtag_channels: [] # e.g. ["#meshmap"]; '#' prefix optional, names are lowercased
  channels: [] # named 16-byte PSKs
    # - name: "bot"
    #   key: "eb50a1bcb3e4e5d7bf69a57c9dada211"
```

Optional fork feature, disabled by default. When `enabled` is `true` and at least one channel is listed, the broker attempts to decrypt observed GRP_TXT group messages at ingest using the configured keys. Hashtag channel names are case-insensitive and normalized to lowercase before deriving the key (first 16 bytes of SHA-256 of the `#name`, matching MeshCore firmware), and duplicate names are removed. Explicit channel keys must be exactly 32 hexadecimal characters (16 bytes); names must be at most 64 characters; at most 100 channels may be configured in total. Invalid values stop startup with a configuration error.

Decrypted messages are stored and exposed as plaintext (`encrypted: false`, `text`, `channel_name`, `decrypted_sender`, `decrypted_flags`), and the used PSK is exposed as `channel_key` for explicit `channels` entries (`null` for hashtag channels). **Everything in these lists — plaintext and channel keys — becomes public through the anonymous MCP/REST surface.** Only list channels whose content and keys may be public. Channel keys are secrets: protect `config.yaml` and never log them; the broker logs only channel counts. See [`MCP.md`](MCP.md) and [`SECURITY.md`](SECURITY.md).

## Target MQTT

| Setting                           | Default        | Validation                                                         |
| --------------------------------- | -------------- | ------------------------------------------------------------------ |
| `target_mqtt.url`                 | empty/disabled | String passed to the MQTT client; no startup URL-scheme validation |
| `target_mqtt.username`            | empty          | Target credential                                                  |
| `target_mqtt.password`            | empty          | Target credential                                                  |
| `target_mqtt.reject_unauthorized` | `true`         | Boolean TLS certificate verification                               |
| `target_mqtt.reconnect_period_ms` | `5000`         | Integer `0..300000`                                                |
| `target_mqtt.connect_timeout_ms`  | `30000`        | Integer `1000..300000`                                             |

Target forwarding is best-effort QoS 0 and accepts only authenticated observer `status`, `packets`, `raw`, and `neighbors` publishes. Private, serial, nested custom, and other public subtopics are not forwarded. Ordinary messages are dropped while disconnected or when publication fails. `/neighbors` is retained on the target; its durable clear deadline is recorded before the forwarding attempt and is retried after reconnect or restart until the clear succeeds.

## MeshCore.io

| Setting                            | Default                                        | Validation                                                    |
| ---------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| `meshcore_io.enabled`              | `false`                                        | Explicit opt-in                                               |
| `meshcore_io.api_url`              | `https://map.meshcore.io/api/v1/uploader/node` | Non-empty string passed to `fetch`; no startup URL validation |
| `meshcore_io.dry_run`              | `false`                                        | Boolean                                                       |
| `meshcore_io.min_reupload_seconds` | `3600`                                         | Integer `0..86400`                                            |
| `meshcore_io.request_timeout_ms`   | `10000`                                        | Integer `1000..120000`                                        |
| `meshcore_io.workers`              | `1`                                            | Integer `1..32`                                               |
| `meshcore_io.max_queued_uploads`   | `250`                                          | Integer `1..100000`                                           |
| `meshcore_io.attempts`             | `3`                                            | Integer `1..100`                                              |
| `meshcore_io.retry_delay_ms`       | `5000`                                         | Integer `0..300000`                                           |
| `meshcore_io.ingress_dedup_ms`     | `10000`                                        | Integer `1000..300000`                                        |

MeshCore.io accepts validated repeater, room, and sensor adverts only when enabled. Its ingress, deduplication, jobs, retry state, history, totals, radio parameters, and seven-day map state are stored in the embedded database. The independent nodes API advert recorder remains active even when `meshcore_io.enabled` is false.

## Proxy and healthcheck

`proxy.trust_proxy` defaults to false. `proxy.trusted_proxy_cidrs` is a comma-separated CIDR list used only when proxy trust is enabled. If trust is enabled with an empty list, only `127.0.0.1/32` and `::1/128` are trusted. Invalid CIDR entries are ignored rather than rejected at startup. A trusted proxy may supply the client address through `CF-Connecting-IP`, the first `X-Forwarded-For` item, or `X-Real-IP`, in that priority order; direct clients cannot override their socket address. This address feeds connection logging and IP rate limiting.

Healthcheck settings are `mqtt_timeout_ms` (default `10000`, minimum `1`), `mqtt_keepalive_seconds` (default `60`, range `0..65535`; `0` disables PINGREQs), and optional `mqtt_port`, `mqtt_url`, `mqtt_client_id`, `mqtt_topic`, and `mqtt_payload` overrides for the internal loopback check. `mqtt_payload` must encode to no more than 512 bytes. These overrides are read by the healthcheck process rather than validated by broker startup. The check authenticates with generated `docker_health` credentials, subscribes, publishes a unique payload, requires that exact payload back, and then probes the existing Turso database; it does not start another broker.

## Abuse protection

Implemented abuse controls are the duplicate history window, per-packet copy limit, duplicate-rate limit, token bucket, raw packet-size anomaly, anomaly threshold, and enforcement switch. Invalid/unlisted region publishes are denial events and do not by themselves create an abuse mute.

| Setting                           | Required/default           | Runtime behavior                                                                                      |
| --------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------- |
| `abuse.enforcement_enabled`       | required boolean           | `false` disables mute state transitions; counters still update, but no `would_mute` record is created |
| `abuse.duplicate_window_size`     | required, minimum `1`      | Maximum retained recent packet hashes                                                                 |
| `abuse.duplicate_window_ms`       | required, minimum `1`      | Age window for duplicate packet hashes                                                                |
| `abuse.duplicate_threshold`       | required, minimum `1`      | Parsed for compatibility but currently not enforced                                                   |
| `abuse.max_duplicates_per_packet` | `5`, minimum `1`           | Copy count before recording an anomaly                                                                |
| `abuse.duplicate_rate_threshold`  | `0.3`, range `0..1`        | Duplicate-rate anomaly threshold                                                                      |
| `abuse.duplicate_rate_window_ms`  | `300000`, minimum `1`      | Duplicate-rate measurement window                                                                     |
| `abuse.bucket_capacity`           | required, minimum `1`      | Initial/maximum token count                                                                           |
| `abuse.bucket_refill_rate`        | required, greater than `0` | Tokens restored per second                                                                            |
| `abuse.max_packet_size`           | required, minimum `1`      | Raw packet payload size anomaly threshold                                                             |
| `abuse.max_topics_per_day`        | required, minimum `1`      | Parsed for compatibility but currently not enforced                                                   |
| `abuse.anomaly_threshold`         | required, minimum `1`      | Anomaly count that triggers a mute only when enforcement is enabled                                   |
| `abuse.max_iata_changes_24h`      | required, minimum `1`      | Logging threshold only; never denies or mutes by itself                                               |
| `abuse.topic_history_size`        | required, minimum `1`      | Parsed for compatibility but currently not enforced                                                   |
| `abuse.topic_history_window_ms`   | required, minimum `1`      | Parsed for compatibility but currently not enforced                                                   |

## Hard-coded behavior

Map providers, styles, attribution, dashboard/API routes, Swagger behavior, the seven-day node/region retention window, the bundled Sweden geofence, and production database path are source-defined. None has a YAML or environment override.
