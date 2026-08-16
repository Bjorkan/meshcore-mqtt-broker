# Public REST API V2

| Property       | Value                                 |
| -------------- | ------------------------------------- |
| Base URL       | `/api/v2`                             |
| Access         | Public                                |
| Authentication | None                                  |
| Mode           | Read-only                             |
| Framework      | Fastify 5 on the shared HTTP listener |
| OpenAPI        | `/api/v2/openapi.json`                |
| Docs UI        | `/api/v2/docs`                        |

The REST API and the MCP endpoint at `/mcp/v2` are two transport layers over the **same** query service, public DTOs, privacy policy, and MeshCore semantics. Domain logic is implemented once; neither transport owns its own copy. No Authorization header, cookie, account, or API key is required or accepted.

## System resources

```text
GET /api/v2
GET /api/v2/capabilities
GET /api/v2/storage
GET /api/v2/schema
GET /api/v2/network/summary
```

`/capabilities` reports retention (runtime configuration), page and timeseries limits, supported buckets/views/count modes/sort fields, and grouping/geospatial/batch flags. `/schema` is the self-describing data dictionary.

## Regions

```text
GET /api/v2/regions
GET /api/v2/regions/:region
GET /api/v2/regions/:region/summary
```

Regions are three-letter IATA codes (`code_system: "IATA"`). Region filters on packet/activity queries mean the region of the observer that made the observation; one logical packet can therefore be observed in several regions.

## Observers and nodes

```text
GET /api/v2/observers
GET /api/v2/observers/:publicKey
GET /api/v2/observers/:publicKey/status
GET /api/v2/observers/:publicKey/neighbors
GET /api/v2/observers/:publicKey/signals

GET /api/v2/nodes
GET /api/v2/nodes/:publicKey
GET /api/v2/nodes/:publicKey/adverts
GET /api/v2/nodes/:publicKey/sightings
GET /api/v2/nodes/:publicKey/telemetry
GET /api/v2/nodes/:publicKey/signals
GET /api/v2/nodes/:publicKey/positions
```

Filters: `region`, `role`, `name`, `public_key`, `active_since`, `has_neighbor_data`, geospatial filters, `sort`/`order` (allowlists: `last_seen_at`, `first_seen_at`), `limit`, `cursor`. The same public key may legitimately be both an observer and a node; the two resources are separate views of the same identity.

## Packets, adverts, messages

```text
GET /api/v2/packets
GET /api/v2/packets/:logicalPacketId
GET /api/v2/packets/:logicalPacketId/raw-packets

GET /api/v2/raw-packets/:packetHash

GET /api/v2/adverts
GET /api/v2/adverts/:logicalAdvertId
GET /api/v2/adverts/:logicalAdvertId/raw-packets

GET /api/v2/messages
GET /api/v2/messages/:messageId
GET /api/v2/messages/:messageId/raw-packets
```

Three levels are modeled explicitly:

1. **Logical transmission** — one MeshCore event grouped across FLOOD routes and observers. The default view.
2. **Raw routed packet instance** — one byte-identical packet, identified by its SHA-256 hash.
3. **RF observation** — one observer reception, listed through `/api/v2/paths` (see below).

Detail routes (`/packets/:logicalPacketId`, `/adverts/:logicalAdvertId`, `/raw-packets/:packetHash`, `/messages/:messageId`, `/nodes/:publicKey`, `/observers/:publicKey`) return object-shaped `data` (or `null` with `404` when missing); list and expansion routes return arrays.

`raw_packet_count`, `route_count`, `observation_count`, and `*_total` fields distinguish window-scoped aggregates from global history. Window-scoped aggregates are computed over the observations matching the query; `first_seen_at_total`/`last_seen_at_total`/`observation_count_total` cover the entity's global history.

Packet search supports `view=logical|raw`, `packet_hash`, `logical_packet_id`, `observer_public_key`, `node_public_key`, `region`, `packet_type`, `payload_type`, `route_type`, `decode_status`, `min_*`/`max_*` filters for RSSI/SNR/score/hops, `sort`/`order` (`last_observed_at`, `first_observed_at`), `from`/`to`, `limit`, `cursor`. `node_public_key` matches any sighted node: advert owner, message sender or destination, TRACE or telemetry source, or resolved path hop.

Message rows carry `channel`, `channel_index`, `channel_name`, `channel_key`, `encrypted`, `text`, `decrypted_sender`, `decrypted_flags`, `signature`, and `signature_valid`. `GET /api/v2/messages/:messageId` additionally returns `payload_hex` (the raw payload/ciphertext as uppercase hexadecimal, `null` when empty); search lists never include payload bytes — use `POST /api/v2/batch/message-payloads` to fetch up to 100 payloads by `message_id` in one call. `channel_key` is the PSK hexadecimal for operator-configured explicit channels and `null` otherwise; see the channel decryption section in [`CONFIGURATION.md`](CONFIGURATION.md).

## Prefixes, paths, traces, events

```text
GET /api/v2/prefixes/:prefix/resolution
GET /api/v2/paths
GET /api/v2/path-prefixes
GET /api/v2/events
GET /api/v2/traces
GET /api/v2/traces/:traceId
```

Prefix resolution uses the exact prefix length (1, 2, or 3 bytes): 0 candidates is `unresolved`, 1 is `resolved`, 2+ is `ambiguous` with the full candidate set. Path hops carry the same candidate sets so clients never need a separate resolution call per hop. TRACE responses expose the diagnostic payload hops; the routed transport path of the carrying packet is separate data under `/api/v2/paths` (filter with `packet_hash`).

`GET /api/v2/paths` pages per-observation paths (only observations with an observed path are returned) with live hop-prefix resolution against currently known nodes, so historical paths resolve against nodes that became known later. Filters: `region`, `logical_packet_id`, `packet_hash`, `observer_public_key`, `contains_prefix_hex`, `contains_node_public_key`, `min_hops`/`max_hops` (0..64), `contains_resolution_status` (matches paths that contain at least one hop with the given status), `sort`/`order` (`received_at`), `from`/`to`, `limit` (max 100), `cursor`.

`GET /api/v2/path-prefixes` aggregates observed hop prefixes server-side with `occurrence_count`, `logical_packet_count`, `raw_packet_count`, `observer_count`, `first_seen_at`/`last_seen_at`, and live `resolution_status`/`resolved_public_key`. It is neutral: no anomaly scoring and no node-type classification. Pagination over mutable aggregates freezes the time window inside the cursor so pages stay stable while new traffic ingests. Filters: `region`, `prefix_hex`, `resolution_status`, `min_occurrences`, `sort`/`order` (`occurrence_count`, `first_seen_at`, `last_seen_at`), `from`/`to`, `limit`, `cursor`.

`GET /api/v2/events` is a stateless, time-ordered correlation stream across `packet`, `advert`, `message`, `trace`, `telemetry`, and `observer_status` events. `from` is inclusive and several event types can share a timestamp, so the official watermark pattern is: page with the opaque cursor until `has_more` is `false`, then advance `from` to the last consumed `timestamp` plus one millisecond. The server stores no client state, watches, or subscriptions. `node_public_key` and `observer_public_key` filters follow the underlying relations (packet events match via node sightings and RF observations, advert events via their owner node and observations, message events via sender or destination). Each event carries `timestamp`, `event_type`, `event_id`, region and keys where applicable, `packet_hash`/`logical_packet_id` where applicable, `rssi`/`snr` where applicable, and a namespaced `payload` object (`{ packet: ... }`, `{ advert: ... }`, `{ message: ... }`, `{ trace: ... }`, `{ telemetry: ... }`, `{ observer_status: ... }`) with boolean JSON types for boolean fields. Filters: `region`, `node_public_key`, `observer_public_key`, `event_types` (comma-separated), `sort`/`order` (`received_at`), `from`/`to`, `limit`, `cursor`.

## Telemetry, neighbors, signals, activity

```text
GET /api/v2/telemetry
GET /api/v2/neighbors
GET /api/v2/activity
GET /api/v2/network/topology
GET /api/v2/network/packet-types
GET /api/v2/observers/summary
GET /api/v2/nodes/summary
GET /api/v2/data-quality
GET /api/v2/processing-errors
```

Activity buckets are `minute`, `hour`, or `day` and are bounded (max 1,440 buckets); oversized requests get a typed `400 invalid_request` with reason `too_many_time_buckets`. Topology edges are observed evidence (packet paths, TRACE hops, neighbor snapshots) with evidence types, observation counts, timing, median SNR, and an evidence-strength `confidence`; they are not presented as ground truth.

## Batch lookups

```text
POST /api/v2/batch/nodes
POST /api/v2/batch/observers
POST /api/v2/batch/raw-packets
POST /api/v2/batch/prefix-resolution
POST /api/v2/batch/traces
POST /api/v2/batch/message-payloads
```

Each accepts at most 50 items and returns found items plus explicit missing-key lists, except `message-payloads` which accepts up to 100 `message_ids` and returns `{ payloads: [{ message_id, encrypted, payload_hex }], missing_message_ids }`.

## Pagination and ordering

Collections return `{ data, meta }` where `meta` carries `generated_at`, `retention_days`, `next_cursor`, `has_more`, and `truncated`. Cursors are opaque, bound to the resource and the canonical filter/sort set, and rejected with `400 invalid_request` (`invalid_pagination_cursor`) when reused elsewhere. Keep `from`/`to` consistent across a page sequence — either omit them on every page or pass the identical values on every page. For every time-windowed resource, the effective time window is frozen inside the cursor so pages stay stable while new traffic ingests. `has_more: true` always comes with a usable `next_cursor`. Ordering is stable and deterministic; `sort`/`order` accept only the per-resource allowlist documented above.

## Stateless contract

The API is fully stateless from a client and query perspective: no client, session, watch, subscription, watermark, or cursor state is stored, and no sticky sessions are required. Any instance sharing the persistent database can serve any page of a pagination, and a cursor keeps working after a full restart while the referenced data is inside retention.

- **Self-contained cursors:** a cursor carries its version, query identity, canonical filters, sort/order, keyset position with stable tie-breakers, and the frozen effective time window. Continuation pages may send only the cursor and a new `limit`; re-supplied filters must equal the cursor's canonical filters. Exception: `/api/v2/observers/:key/signals` and `/api/v2/activity` require their mandatory query arguments on every page because the bucket grid is part of the query definition.
- **Integrity:** cursors are HMAC-SHA256 signed with a database-persisted secret (stable across restarts and shared by all instances). Tampering yields `400 invalid_request` (`invalid_pagination_cursor`); a validly signed cursor with an unknown version yields `unsupported_cursor_version`.
- **Snapshot watermark:** the first page freezes `effective_to` inside the cursor; later pages query the same logical result set under live ingest. This holds for all paginated resources, including `/api/v2/path-prefixes` sorted by `occurrence_count` or `last_seen_at`.
- **Keyset only:** tie-breakers are stable ids, `(timestamp, event_type, event_id)` for `/api/v2/events`, and `prefix_hex` for prefix aggregates.
- **Retention:** a cursor entirely outside the retained window fails with `400 invalid_request` (`cursor_outside_retention_window`); partially expired windows are clamped like fresh queries.
- **Watermark polling:** `from` is inclusive and event types can share a timestamp; page with the cursor until `has_more` is `false`, then advance `from` to the last consumed timestamp plus one millisecond.

`GET /api/v2/capabilities` reports `stateless_queries`, `stateless_cursors`, `cursor_version`, `cursor_integrity_protected`, `pagination_mode`, and `supports_snapshot_watermark`; `GET /api/v2/schema` documents `cursor_semantics`.

## Errors

```text
200 OK
400 Bad Request  { status, reason, message }
404 Not Found    { status, reason, data }
405 Method Not Allowed
413 Payload Too Large
500 Internal Server Error
503 Service Unavailable
```

Statuses: `ok`, `not_found`, `no_data`, `ambiguous`, `unresolved`, `invalid_request`, `data_quality_error`, `internal_error`, `service_unavailable`. Missing entities are `not_found`; entities without the requested data kind are `no_data` with a specific reason. Empty search results are `200` with `{"data":[]}`. Errors never contain SQL, stack traces, filesystem paths, or credentials.

## Timestamps, units, privacy

Canonical times are server observation times. The node's own embedded advert timestamp is preserved as `advert_timestamp_raw`, including implausible or future values. `0,0` positions are normalized to missing positions with `position_quality: "zero_zero_sentinel"` on advert and position-history rows so the sentinel can be distinguished from a missing location. Metric units come from a central dictionary (`mV`, `dBm`, `dB`, `s`, `MHz`).

The public policy is field- and source-based: values from the public MeshCore `/status`, `/packets`, and `/neighbors` feeds pass unchanged even when they look like e-mail addresses or IP addresses. `mqtt.email`, real broker client/connection IP fields, credentials, `/internal` data, and other private broker state never enter any public DTO.
