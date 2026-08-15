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
GET /api/v2/raw-packets/:packetHash/observations
GET /api/v2/raw-packets/:packetHash/path

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
3. **RF observation** — one observer reception.

`raw_packet_count`, `route_count`, `observation_count`, and `*_total` fields distinguish window-scoped aggregates from global history. Window-scoped aggregates are computed over the observations matching the query; `first_seen_at_total`/`last_seen_at_total`/`observation_count_total` cover the entity's global history.

Packet search supports `view=logical|raw`, `packet_hash`, `logical_packet_id`, `observer_public_key`, `node_public_key`, `region`, `packet_type`, `payload_type`, `route_type`, `decode_status`, `min_*`/`max_*` filters for RSSI/SNR/score/hops, `sort`/`order` (`last_observed_at`, `first_observed_at`), `from`/`to`, `limit`, `cursor`. `node_public_key` matches any sighted node: advert owner, message sender or destination, TRACE or telemetry source, or resolved path hop.

## Prefixes, paths, traces

```text
GET /api/v2/prefixes/:prefix/resolution
GET /api/v2/raw-packets/:packetHash/path
GET /api/v2/traces
GET /api/v2/traces/:traceId
```

Prefix resolution uses the exact prefix length (1, 2, or 3 bytes): 0 candidates is `unresolved`, 1 is `resolved`, 2+ is `ambiguous` with the full candidate set. Path hops carry the same candidate sets so clients never need a separate resolution call per hop. TRACE responses expose the diagnostic payload hops; the routed transport path of the carrying packet is separate data under `/raw-packets/:packetHash/path`.

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
```

Each accepts at most 50 items and returns found items plus explicit missing-key lists.

## Pagination and ordering

Collections return `{ data, meta }` where `meta` carries `generated_at`, `retention_days`, `next_cursor`, `has_more`, and `truncated`. Cursors are opaque, bound to the resource and the normalized filter/sort set, and rejected with `400 invalid_request` (`invalid_pagination_cursor`) when reused elsewhere. `has_more: true` always comes with a usable `next_cursor`. Ordering is stable and deterministic; `sort`/`order` accept only the per-resource allowlist documented above.

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

Canonical times are server observation times. The node's own embedded advert timestamp is preserved as `advert_timestamp_raw`, including implausible or future values. `0,0` positions are normalized to missing positions. Metric units come from a central dictionary (`mV`, `dBm`, `dB`, `s`, `MHz`).

The public policy is field- and source-based: values from the public MeshCore `/status`, `/packets`, and `/neighbors` feeds pass unchanged even when they look like e-mail addresses or IP addresses. `mqtt.email`, real broker client/connection IP fields, credentials, `/internal` data, and other private broker state never enter any public DTO.
