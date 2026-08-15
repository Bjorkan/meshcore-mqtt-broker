# Public MCP V2

MeshCore MQTT Broker exposes its normalized, retention-bounded history through a public Model Context Protocol endpoint.

| Property       | Value                               |
| -------------- | ----------------------------------- |
| Endpoint       | `/mcp/v2`                           |
| Access         | Public                              |
| Authentication | None                                |
| Mode           | Read-only                           |
| Transport      | MCP Streamable HTTP on the web port |
| MCP revision   | `2026-07-28`                        |

The endpoint is hosted by the existing long-lived Node.js process and shared HTTP/WebSocket listener. It uses the stable `@modelcontextprotocol/server` and `@modelcontextprotocol/node` V2 packages. It does not start another listener, broker, database, worker, or cloud service. There is no OAuth, JWT, API key, cookie, login, or MQTT subscriber authentication on this endpoint.

## Configuration

```yaml
mcp:
  enabled: true
  path: /mcp/v2
  default_limit: 50
  max_limit: 250
```

`enabled` defaults to `true`. The path is deliberately fixed: any value other than `/mcp/v2` is a configuration error. `default_limit` and `max_limit` must be positive integers, `default_limit` must not exceed `max_limit`, and `max_limit` cannot exceed 1,000.

## Tools

Every tool is annotated as read-only, non-destructive, idempotent, and closed-world. Except for `get_capabilities`, successful responses use `{ data, meta }`, where `meta` contains the UTC generation time, configured retention period, next cursor, `has_more`, and `truncated`.

| Tool                          | Purpose                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `get_capabilities`            | Protocol, access, storage, retention, limits, and feature capabilities                                                         |
| `get_storage_info`            | Public retention and normalized record counts                                                                                  |
| `get_network_summary`         | Bounded observer, node, packet, advert, neighbor, and activity summary                                                         |
| `list_regions`                | Configured or observed three-letter IATA regions                                                                               |
| `get_region_summary`          | Observer, node, repeater, packet, advert, and message activity for one region                                                  |
| `search_adverts`              | Search logical adverts across all nodes with node, name, role, region, verification, location, and geospatial filters          |
| `get_nodes`                   | Batch node details for up to 100 public keys                                                                                   |
| `get_observers`               | Batch observer details for up to 100 public keys                                                                               |
| `get_packets`                 | Batch packet details for up to 100 packet hashes                                                                               |
| `get_schema`                  | Self-describing data dictionary: roles, types, units, regions, views, count/timestamp semantics, filter dimensions, pagination |
| `list_observers`              | Page observers by region, activity, and time                                                                                   |
| `get_observer`                | One observer's public state and latest normalized neighbor snapshot                                                            |
| `get_observer_status_history` | Page normalized status history for one observer                                                                                |
| `list_nodes`                  | Page nodes by role, name, region, location, geospatial area, and hearing time                                                  |
| `get_node`                    | One node's normalized identity and latest public state                                                                         |
| `get_node_adverts`            | Page logical adverts for one node, grouped across FLOOD routes                                                                 |
| `get_node_sightings`          | Page explicit observer sightings for one node                                                                                  |
| `resolve_node_prefix`         | Resolve a hexadecimal public-key prefix to explicit candidates                                                                 |
| `search_packets`              | Page logical packets (default) or raw packet identities                                                                        |
| `get_packet`                  | One normalized packet identity, decoded fields, and raw packet hex                                                             |
| `get_packet_observations`     | Page explicit observer receptions for a packet                                                                                 |
| `get_neighbors`               | Current normalized neighbors for an observer                                                                                   |
| `get_neighbor_history`        | Page normalized neighbor snapshots and entries                                                                                 |
| `get_packet_path`             | Explicit decoded route/path data for a packet                                                                                  |
| `get_signal_history`          | Time-bucketed RSSI and SNR observations                                                                                        |
| `search_traces`               | Page normalized trace records                                                                                                  |
| `get_trace`                   | One trace and its explicit hops                                                                                                |
| `get_telemetry`               | Page normalized telemetry by node and metric                                                                                   |
| `search_messages`             | Page logical messages (default) or per-observation message records                                                             |
| `get_message`                 | One stored message record with logical identity and counts                                                                     |
| `search_telemetry`            | Search telemetry values across nodes by node, metric, and region                                                               |
| `get_node_signal_summary`     | Per-observer packet counts and median RSSI/SNR for one node                                                                    |
| `search_neighbors`            | Search neighbor entries across observers by region, keys, and SNR                                                              |
| `get_activity_timeseries`     | Time-bucketed observer, packet, message, and telemetry activity                                                                |

Use `get_capabilities` before relying on an optional data family. It reports the deployed server version, the highest supported MCP protocol revision, anonymous/read-only contract, storage availability, retention, page/bucket limits, the default summary window, supported buckets and views, logical grouping modes, and support flags. Treat retention as runtime configuration: read it from `get_capabilities` or `get_storage_info` instead of assuming a fixed number of days.

## Query behavior

All inputs use strict Zod schemas. Unknown properties, malformed public keys, packet hashes, prefixes, timestamps, cursors, enum values, and out-of-range limits are rejected. SQL uses bound parameters and fixed allowlisted statements; there is no generic SQL or table tool.

List tools default to 50 results and use deterministic newest-first keyset pagination. Supply the returned opaque `next_cursor` unchanged to continue. Cursors are bound to the tool and the normalized filter set: a cursor from another tool or filter combination is rejected with a typed `invalid_request` (`invalid_pagination_cursor`). The configured maximum is 250 by default. Time ranges are clamped to the broker's configured history retention, `from` must not be later than `to`, and inconsistent `min_*`/`max_*` filter pairs are rejected as typed `invalid_request` errors. Database operations retain the broker's bounded query timeout.

## Logical packet model

Three levels are modeled explicitly:

1. **logical packet/message** — one MeshCore transmission, grouped across FLOOD routes and observers. `search_packets` and `search_messages` default to this view (`view: "logical"`), `get_node_adverts` always groups by logical advert, and `get_network_summary.advert_count`/`message_count` count logical adverts/messages.
2. **raw routed packet instance** — one byte-identical packet. Use `view: "raw"` on `search_packets`/`search_messages`, or filter by `logical_packet_id` to expand a logical packet to its raw packets. `get_packet` returns one raw packet with its `logical_packet_id`.
3. **RF observation** — one observer reception. Use `get_packet_observations`.

Logical rows carry `raw_packet_count`, `route_count`, `observation_count`, and `raw_packet_hashes` where applicable. The logical identity is a per-type canonical payload hash (signed advert key/timestamp/signature, message source/destination/channel/ciphertext/timestamp, trace tag/hops/SNR, response telemetry) with a raw-hash fallback for undecoded or content-free packet types; route/path bytes never affect it.

`get_network_summary` defaults to the last 24 hours (clamped to retention) and reports the effective window as `window_from`/`window_to`. Its advert/message counts are logical (`advert_count`, `message_count`) with separate raw/observation counters (`advert_raw_packet_count`, `advert_observation_count`, `message_observation_count`), plus `logical_packet_count`. `get_activity_timeseries` counts logical adverts and messages per bucket the same way, rejects ranges that would produce more than 1,440 buckets with a typed `invalid_request` suggesting a coarser bucket, and supports `limit`/`cursor` keyset pagination over bucket timestamps. `search_packets` aggregates (`first_seen_at`, `last_seen_at`, `observation_count`, RSSI/SNR/hop aggregates) are scoped to the observations matching the query, while the `*_total` fields report the packet's global history.

Geospatial filters are available on `list_nodes` and `search_adverts`: `latitude`/`longitude` with `radius_km`, or a bounding box (`min_latitude`, `max_latitude`, `min_longitude`, `max_longitude`). Positions normalized to missing are never matched.

Responses use typed result states: successful envelopes omit `status`, missing entities return `status: "not_found"`, entities without the requested data kind return `status: "no_data"` with a specific `reason` (for example `observer_exists_but_has_no_neighbor_snapshot`), and invalid arguments are typed `invalid_request` errors with a machine-readable `reason`.

Incoming JSON request bodies are limited to 1 MiB, no more than 32 requests per public transport are processed concurrently, and the final serialized tool output is limited to 4 MiB. Protocol and tool errors are stable and sanitized; stack traces, SQL, database paths, and exception details are not returned.

## Public data boundary

The MCP surface reads normalized history created from accepted public MeshCore status, packet, and neighbor traffic. It may expose:

- complete observer and node public keys, names, regions, and explicit public relationships;
- public advert location, role, model, firmware, radio settings, and signature fields;
- packet hashes, decoded allowlisted protocol fields, raw public packet bytes as hexadecimal, RF observations, paths, traces, telemetry, and public message plaintext when decoding produced plaintext;
- aggregate and time-bucketed counts.

It does not expose subscriber usernames, client IDs, socket IP addresses, passwords, tokens, cookies, authorization headers, private keys, target broker credentials, Turso credentials, database URLs/paths, stack traces, private broker state, `$SYS/*`, `/internal/*`, serial command/response traffic, unknown MQTT topics, generic raw MQTT payloads, generic file access, or generic database access. Encrypted message content is not decrypted and is returned as unavailable rather than guessed.

### Decided public-data semantics

- Canonical "latest advert" times are the server's observation times of the advert. The node's own embedded advert timestamp is preserved separately as `advert_timestamp_raw`, including when the node clock is implausible.
- A position of latitude 0 and longitude 0 is normalized to a missing position; the raw value remains available in raw/diagnostic data.
- Metric units come from a central metric dictionary (`mV`, `dBm`, `dB`, `s`, `MHz`, and so on) and are applied consistently by ingestion and all query tools.
- The same public key can legitimately identify both an observer and a MeshCore node; the two identity views are not mutually exclusive.
- Regions are three-letter IATA codes (`code_system: "IATA"`). `list_regions` and `get_region_summary` expose configured or observed regions, and region filters match the observer/observation region.

### Public output policy

Every tool result passes through the same recursive public-output policy immediately before serialization. The policy is field- and source-based, not content-based: values that originate from the public MeshCore `/status`, `/packets`, and `/neighbors` feeds are preserved even when they happen to look like e-mail addresses or IP addresses (for example node names, firmware versions, or public message text). Specific sensitive fields such as `mqtt.email` and real broker client/connection IP fields never enter the public DTO, and disallowed field names are removed at any nesting level. Cycles, unsupported objects, excessive nesting, or excessive output complexity fail closed with a safe MCP error and no partial structured payload.

Logs contain a generated request identifier, tool name, duration, success state, result count, and truncation state. They do not record client IP addresses, credentials, query contents, or returned public data. Aggregate in-process counters record blocked sensitive fields and policy failures.

## Client example

An MCP V2 client connects directly without authentication headers:

```ts
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client/streamableHttp";

const client = new Client({ name: "meshcore-reader", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL("https://example.net/mcp/v2")),
);

const capabilities = await client.callTool({
  name: "get_capabilities",
  arguments: {},
});
```

## Plain HTTP API

Clients that do not implement MCP can run every identically named tool through the ordinary public JSON API:

```bash
curl -X POST https://example.net/api/v2/tools/get_observer \
  -H 'content-type: application/json' \
  -d '{"public_key":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}'
```

`GET /api/v2` lists all 34 supported names. `POST /api/v2/tools/{toolName}` accepts exactly the same JSON arguments object as MCP and returns exactly the same sanitized structured content. Both transports share the same tool registry, strict Zod schemas, query service, DTOs, cursor semantics, limits, and final output policy. Neither transport accepts or requires credentials. Invalid input returns HTTP `400`, unknown tools return `404`, oversized bodies return `413`, and internal/safety failures return only sanitized errors.

The Node.js listener is plain HTTP/WebSocket. Terminate TLS at a trusted reverse proxy for an Internet-facing deployment. Since MCP access is intentionally anonymous, proxy authentication changes the deployment access policy and is optional rather than required by the broker.
