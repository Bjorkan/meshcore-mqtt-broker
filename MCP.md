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

| Tool                          | Purpose                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_capabilities`            | Protocol, access, storage, retention, limits, and feature capabilities                                                                     |
| `get_storage_info`            | Public retention and normalized record counts                                                                                              |
| `get_network_summary`         | Bounded observer, node, packet, advert, neighbor, and activity summary                                                                     |
| `list_regions`                | Configured or observed three-letter IATA regions                                                                                           |
| `get_region_summary`          | Observer, node, repeater, packet, advert, and message activity for one region                                                              |
| `search_adverts`              | Search logical adverts across all nodes with node, name, role, region, verification, location, and geospatial filters                      |
| `get_nodes`                   | Batch node details for up to 100 public keys                                                                                               |
| `get_observers`               | Batch observer details for up to 100 public keys                                                                                           |
| `get_packets`                 | Batch packet details for up to 100 packet hashes                                                                                           |
| `get_node_position_history`   | Deduplicated logical-advert positions for one node                                                                                         |
| `search_processing_errors`    | Sanitized processing and decode diagnostics by stage, code, packet, observer, and region                                                   |
| `get_data_quality_summary`    | Counts of signatures, decode, timestamp, position, RSSI/SNR, prefix, route, and processing quality issues                                  |
| `get_packet_type_summary`     | Rank packet types by logical, raw, and observation counts                                                                                  |
| `get_observer_summary`        | Rank observers by observations, packets, and heard nodes                                                                                   |
| `get_node_summary`            | Rank nodes by sightings, observers, and logical packets                                                                                    |
| `get_topology`                | Observed node-to-node edges from paths, TRACE hops, and neighbor snapshots with evidence and confidence                                    |
| `get_schema`                  | Self-describing data dictionary: roles, types, units, regions, views, count/timestamp semantics, filter dimensions, pagination             |
| `list_observers`              | Page observers by region, activity, neighbor-data availability, and time                                                                   |
| `get_observer`                | One observer's public state and latest normalized neighbor snapshot                                                                        |
| `get_observer_status_history` | Page normalized status history for one observer                                                                                            |
| `list_nodes`                  | Page nodes by role, name, region, location, geospatial area, and hearing time                                                              |
| `get_node`                    | One node's normalized identity and latest public state                                                                                     |
| `get_node_adverts`            | Page logical adverts for one node, grouped across FLOOD routes                                                                             |
| `get_node_sightings`          | Page explicit observer sightings for one node                                                                                              |
| `resolve_node_prefix`         | Resolve a hexadecimal public-key prefix to explicit candidates                                                                             |
| `search_packets`              | Page logical packets (default) or raw packet identities                                                                                    |
| `get_packet`                  | One normalized packet identity, decoded fields, and raw packet hex                                                                         |
| `search_paths`                | Page per-observation packet paths with live hop-prefix resolution, server-side prefix/node/hop/status filters, and stateless pagination    |
| `search_path_prefixes`        | Aggregate observed path prefixes with counts, observers, live resolution status, and first/last seen times; no anomaly scoring             |
| `search_events`               | Time-ordered packet/advert/message/trace/telemetry/observer-status event stream with namespaced payloads; clients pass their own watermark |
| `get_neighbors`               | Current normalized neighbors for an observer                                                                                               |
| `get_neighbor_history`        | Page normalized neighbor snapshots and entries                                                                                             |
| `get_signal_history`          | Time-bucketed RSSI and SNR observations                                                                                                    |
| `search_traces`               | Page normalized trace records                                                                                                              |
| `get_trace`                   | One trace and its explicit hops                                                                                                            |
| `get_telemetry`               | Page normalized telemetry by node and metric                                                                                               |
| `search_messages`             | Page logical messages (default) or per-observation message records; filters include encryption, signature validity, region, and observer   |
| `get_message`                 | One stored message record with logical identity, counts, and raw payload hex                                                               |
| `get_message_payloads`        | Batch raw message payload (ciphertext) hex for up to 100 message ids, with missing-id reporting                                            |
| `search_telemetry`            | Search telemetry values across nodes by node, metric, and region                                                                           |
| `get_node_signal_summary`     | Per-observer packet counts and median RSSI/SNR for one node                                                                                |
| `search_neighbors`            | Search neighbor entries across observers by region, keys, and SNR                                                                          |
| `get_activity_timeseries`     | Time-bucketed observer, packet, message, and telemetry activity                                                                            |

Use `get_capabilities` before relying on an optional data family. It reports the deployed server version, the highest supported MCP protocol revision, anonymous/read-only contract, storage availability, retention, page/bucket limits, the default summary window, supported buckets and views, logical grouping modes, and support flags. Treat retention as runtime configuration: read it from `get_capabilities` or `get_storage_info` instead of assuming a fixed number of days.

## Query behavior

All inputs use strict Zod schemas. Unknown properties, malformed public keys, packet hashes, prefixes, timestamps, cursors, enum values, and out-of-range limits are rejected. SQL uses bound parameters and fixed allowlisted statements; there is no generic SQL or table tool.

List tools default to 50 results and use deterministic newest-first keyset pagination. Supply the returned opaque `next_cursor` unchanged to continue. Cursors are bound to the tool and the canonical filter set: a cursor from another tool or a conflicting filter combination is rejected with a typed `invalid_request` (`invalid_pagination_cursor`). Keep `from`/`to` consistent across a page sequence — either omit them on every page or pass the identical values on every page. For `search_paths` and `search_path_prefixes`, the effective time window is frozen inside the cursor so pages stay stable while new traffic ingests. The configured maximum is 250 by default (`search_paths` caps at 100). Time ranges are clamped to the broker's configured history retention, `from` must not be later than `to`, and inconsistent `min_*`/`max_*` filter pairs are rejected as typed `invalid_request` errors. Database operations retain the broker's bounded query timeout.

## Stateless contract

The query surface is fully stateless: the server stores no client, query, session, watch, subscription, watermark, or cursor state. A request can be handled by any instance sharing the persistent database, and a cursor keeps working after a full process restart as long as the referenced data is inside the retention window.

- **Self-contained cursors.** A cursor carries its version, the query identity, the canonical filters, the sort field and order, the keyset position with stable tie-breakers, and the frozen effective time window (`from`/`to`). Continuation pages may send only the cursor and a new `limit`; filters do not have to be repeated. If a client re-supplies filters, they must equal the cursor's canonical filters or the cursor is rejected.
- **Integrity protection.** Cursors are HMAC-SHA256 signed with a secret stored in the persistent database (one per broker database, shared by all instances and stable across restarts). Tampered cursors are rejected with `invalid_request` (`invalid_pagination_cursor`); a validly signed cursor with an unknown version is rejected with `unsupported_cursor_version`.
- **Snapshot watermark.** The first page of a time-ordered query freezes its effective upper time bound (`effective_to`) inside the cursor. Later pages query the same logical result set even while new traffic ingests; no server-side snapshot is stored. This applies to all paginated tools, including `search_path_prefixes` where `occurrence_count` and `last_seen_at` otherwise change under live ingest.
- **Keyset, not offset.** All pagination is keyset-based with deterministic tie-breakers: time-ordered rows tie-break on stable integer id, the event stream on `(timestamp, event_type, event_id)`, and prefix aggregates on `prefix_hex`.
- **Retention semantics.** A cursor whose frozen window lies entirely outside the retained history is rejected with `cursor_outside_retention_window` instead of silently returning inconsistent pages. Partially expired windows are clamped like fresh queries.
- **Watermark polling.** `from` is inclusive and several event types can share a timestamp, so the official watermark pattern is: consume pages with the cursor until `has_more` is `false`, then advance `from` to the last consumed `timestamp` plus one millisecond. The server never remembers a client's last position.
- **Discovery.** `get_capabilities` reports `stateless_queries`, `stateless_cursors`, `cursor_version`, `cursor_integrity_protected`, `pagination_mode: "keyset"`, and `supports_snapshot_watermark`; `get_schema` documents the cursor semantics, `effective_to`, inclusive bounds, and tie-breakers.

## Logical packet model

Three levels are modeled explicitly:

1. **logical packet/message** — one MeshCore transmission, grouped across FLOOD routes and observers. `search_packets` and `search_messages` default to this view (`view: "logical"`), `get_node_adverts` always groups by logical advert, and `get_network_summary.advert_count`/`message_count` count logical adverts/messages.
2. **raw routed packet instance** — one byte-identical packet. Use `view: "raw"` on `search_packets`/`search_messages`, or filter by `logical_packet_id` to expand a logical packet to its raw packets. `get_packet` returns one raw packet with its `logical_packet_id`.
3. **RF observation** — one observer reception with an observed routed path. Use `search_paths` (optionally filtered by `packet_hash`); observations without a path are not returned by this tool.

Logical rows carry `raw_packet_count`, `route_count`, `observation_count`, and `raw_packet_hashes` where applicable. The logical identity is a per-type canonical payload hash (signed advert key/timestamp/signature, message source/destination/channel/ciphertext, trace tag/hops/SNR, response telemetry) over decoded payload bytes; only undecodable packets fall back to the raw packet hash, and route/path bytes never affect it.

`get_network_summary` defaults to the last 24 hours (clamped to retention) and reports the effective window as `window_from`/`window_to`. Its advert/message counts are logical (`advert_count`, `message_count`) with separate raw/observation counters (`advert_raw_packet_count`, `advert_observation_count`, `message_observation_count`), plus `logical_packet_count`. `get_activity_timeseries` counts logical adverts and messages per bucket the same way, rejects ranges that would produce more than 1,440 buckets with a typed `invalid_request` suggesting a coarser bucket, and supports `limit`/`cursor` keyset pagination over bucket timestamps. `search_packets` aggregates (`first_seen_at`, `last_seen_at`, `observation_count`, RSSI/SNR/hop aggregates) are scoped to the observations matching the query, while the `*_total` fields report the packet's global history.

Geospatial filters are available on `list_nodes` and `search_adverts`: `latitude`/`longitude` with `radius_km`, or a bounding box (`min_latitude`, `max_latitude`, `min_longitude`, `max_longitude`). Positions normalized to missing are never matched.

Responses use typed result states: successful envelopes omit `status`, missing entities return `status: "not_found"`, entities without the requested data kind return `status: "no_data"` with a specific `reason` (for example `observer_exists_but_has_no_neighbor_snapshot`), and invalid arguments are typed `invalid_request` errors with a machine-readable `reason`.

Incoming JSON request bodies are limited to 1 MiB, no more than 32 requests per public transport are processed concurrently, and the final serialized tool output is limited to 4 MiB. Protocol and tool errors are stable and sanitized; stack traces, SQL, database paths, and exception details are not returned.

## Public data boundary

The MCP surface reads normalized history created from accepted public MeshCore status, packet, and neighbor traffic. It may expose:

- complete observer and node public keys, names, regions, and explicit public relationships;
- public advert location, role, model, firmware, radio settings, and signature fields;
- packet hashes, decoded allowlisted protocol fields, raw public packet bytes as hexadecimal, RF observations, paths, traces, telemetry, and public message plaintext when decoding produced plaintext;
- raw message payload (ciphertext) hexadecimal for stored messages;
- aggregate and time-bucketed counts.

It does not expose subscriber usernames, client IDs, socket IP addresses, passwords, tokens, cookies, authorization headers, private keys, target broker credentials, Turso credentials, database URLs/paths, stack traces, private broker state, `$SYS/*`, `/internal/*`, serial command/response traffic, unknown MQTT topics, generic raw MQTT payloads, generic file access, or generic database access. Encrypted message content is returned as ciphertext only unless the operator has configured the channel key for local decryption (see [Channel decryption](#channel-decryption)); without a configured key it is returned as unavailable rather than guessed.

### Channel decryption

When the operator lists a channel in the `decryption` configuration section, the broker decrypts matching GRP_TXT messages at ingest with the configured channel key (explicit PSK or hashtag-derived). For such messages `encrypted` is `false`, `text` is the plaintext, and the message DTOs additionally expose `channel_name`, `decrypted_sender`, and `decrypted_flags`. `channel_key` carries the PSK hexadecimal used for explicit PSK channels and is `null` for hashtag channels and unknown channels. Everything in the decryption list — plaintext and channel keys — is public through this anonymous surface; see `SECURITY.md` before enabling it.

### Decided public-data semantics

- Canonical "latest advert" times are the server's observation times of the advert. The node's own embedded advert timestamp is preserved separately as `advert_timestamp_raw`, including when the node clock is implausible.
- A position of latitude 0 and longitude 0 is normalized to a missing position; the raw value remains available in raw/diagnostic data.
- Metric units come from a central metric dictionary (`mV`, `dBm`, `dB`, `s`, `MHz`, and so on) and are applied consistently by ingestion and all query tools.
- The same public key can legitimately identify both an observer and a MeshCore node; the two identity views are not mutually exclusive.
- Regions are three-letter IATA codes (`code_system: "IATA"`). `list_regions` and `get_region_summary` expose configured or observed regions, and region filters match the observer/observation region.
- `known_*` counts in `get_network_summary` cover the whole retained history; `active_*` counts and every other summary counter are scoped to the reported `window_from`/`window_to`. "Active" means at least one matching observation in the window (active observers emit accepted status/packet/neighbor events, active nodes have sightings, active repeaters are REPEATER nodes last seen in the window).
- `node_public_key` filters on `search_packets` match packets where that node was sighted: advert owner, message sender or destination, TRACE or telemetry source, or a resolved path hop. It is not limited to source nodes.
- TRACE tool responses expose the TRACE diagnostic hop list (payload hops with per-hop SNR); the routed transport path of the carrying packet is separate data available through `get_packet` and `search_paths`, under different field names.
- `search_paths` and `search_path_prefixes` resolve hop prefixes at query time against currently known nodes (`node_prefix_candidates`), so historical paths resolve against nodes that became known later. Resolution is honest: zero candidates report `unresolved`, one candidate `resolved` with its public key, and multiple candidates `ambiguous` with a bounded candidate list. `search_paths` returns only observations with an observed path; its `contains_resolution_status` filter matches paths that contain at least one hop with the given status (mixed paths match several statuses). `search_path_prefixes` pages over mutable aggregates against a time window frozen in the cursor, so pages stay stable while new traffic ingests. Prefix aggregation in `search_path_prefixes` is neutral and never classifies node types or scores anomalies.
- `search_events` is a stateless correlation stream: the server stores no client state, watches, or subscriptions. `from` is inclusive and several event types can share the same timestamp, so the official watermark pattern is: consume one full page set with the opaque cursor until `has_more` is `false`, then advance `from` to the last consumed `timestamp` plus one millisecond. Cursor pagination is stable within the same timestamp group via `(timestamp, event_type, event_id)`. Type-specific detail lives in a namespaced `payload` field (`{ packet: ... }`, `{ advert: ... }`, `{ message: ... }`, `{ trace: ... }`, `{ telemetry: ... }`, `{ observer_status: ... }`) with boolean JSON types for boolean fields.
- Prefix-candidate `confidence` measures evidence strength for that candidate (verified advert support), not the probability that a colliding prefix resolves to it; ambiguity is reported separately through `resolution_status` and `ambiguous`.
- Paginated tools use a deterministic newest-first keyset order by default. `list_nodes`, `list_observers`, and `search_packets` additionally accept explicit `sort`/`order` parameters with the same field sets as the REST API. Summary tools are rank-ordered by activity so top-N questions are answered server-side.
- `get_topology` edges are observed evidence (resolved packet paths, TRACE hops, neighbor snapshots) carrying evidence types, observation counts, timing, median SNR, and an evidence-strength `confidence` value; they are not presented as absolute ground truth.

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

## REST API

Clients that do not implement MCP can use the public, anonymous, read-only REST API at `/api/v2`, served by Fastify 5 over the same query services, DTOs, privacy policy, and semantics. See [`REST_API.md`](REST_API.md). OpenAPI is generated from the route schemas at `/api/v2/openapi.json` with Swagger UI at `/api/v2/docs`.

The Node.js listener is plain HTTP/WebSocket. Terminate TLS at a trusted reverse proxy for an Internet-facing deployment. Since both public surfaces are intentionally anonymous, proxy authentication changes the deployment access policy and is optional rather than required by the broker.
