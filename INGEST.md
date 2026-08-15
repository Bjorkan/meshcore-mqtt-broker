# MQTT history ingest

## Runtime integration

The history collector is embedded in the one supported broker process. It observes the same accepted public `meshcore/#` traffic with full publisher-visible fields before subscriber-role filtering. It does not create a second MQTT connection, external worker, database, or reconnect loop; Aedes authorization itself is the connection and backpressure boundary.

For an accepted public publish, authorization awaits insertion into `mqtt_events` before Aedes is allowed to distribute it. A database write failure denies the publish and emits an explicit storage error, so loss is not silent. The durable table, rather than an in-memory queue, bounds pending work. One controlled processor claims rows transactionally.

Private `internal` and `serial` roots are excluded by default. Unknown public subtopics are stored, classified, and left available for future reprocessing.

## Pipeline

```text
accepted MQTT publish
        |
        v
insert mqtt_events (authoritative payload_blob)
        |
        v
claim durable pending row
        |
        v
parse topic and resolve observer
        |
        +-- status ----> status event + metrics + radio history
        +-- neighbors -> snapshot + entries + replay classification
        +-- packets ---> packet bytes -> SHA-256 identity -> observation
        |                                  |
        |                                  v
        |                              decoder interface
        |                         / advert / path / trace \
        |                        node   message   telemetry
        |
        `-- unknown ---> preserve raw event and classification
```

The topic parser accepts `meshcore/<REGION>/<OBSERVER_PUBLIC_KEY>/<SUBTOPIC>`, including `test` and nested public subtopics. It records parsing errors without deleting the receipt. `OBSERVER_PUBLIC_KEY` is the uploader identity and is distinct from decoded source, destination, path, and advertised node identities.

All normal payloads are parsed as JSON. Invalid UTF-8, invalid JSON, origin mismatch, missing fields, bad hex, corrupt packets, unknown types, malformed neighbors, decoder failures, and verification failures become searchable `processing_errors`. Missing optional fields are not failures. Original bytes and raw/decoded JSON remain available.

## Supported public roots

- `status`: every receipt becomes an append-only `observer_status_events` row. Known identity/model/firmware fields are normalized; scalar metrics remain extensible by name; known radio parameters get historical rows.
- `neighbors`: every receipt becomes a snapshot. Scopes are trimmed and deduplicated. Unknown status text is retained. A retained receipt with matching observer, topic, payload hash, and reported timestamp is marked as a likely replay; calculated RF hearing time uses the original/report time rather than reconnect receipt time.
- `packets`: packet bytes are extracted from the normal JSON envelope fields used by the broker (`raw`, `packet`, `payload`, or `data`). Upper/lowercase hex and an optional `0x` prefix are accepted. Packet SHA-256 covers decoded bytes, never the JSON envelope. RF fields belong to the observation.
- other public roots: raw MQTT receipt and JSON classification are retained without inventing a protocol model.

The MQTT subtopic `/raw` is not supported by this historical system and must not be implemented. Raw MeshCore bytes carried inside normal `/packets` JSON are the authoritative packet material and are always preserved.

## Decoding and normalization

`MeshCorePacketDecoder` isolates the decoder implementation. The current adapter uses `@michaelhart/meshcore-decoder` and records its name, version, decode time, status, error, packet/payload type and complete decoded JSON. Supported status values are `not_attempted`, `decoded`, `partially_decoded`, `unknown_type`, `invalid_packet`, and `decoder_error`.

Verified adverts update trusted current node state only when their protocol timestamp is not older than the current trusted advert. Invalid/unverified adverts remain historical. Prefix candidates cover one-, two-, and three-byte hashes; resolution succeeds only for a unique candidate. Encrypted messages retain ciphertext and never attempt to bypass MeshCore encryption. Decoder fields without a normalized destination stay in `decoded_json`.

## Recovery and reprocessing

On startup, failed work and stale `processing` claims return to `pending`. Normalized writes occur in transactions after the raw receipt already exists. Event-owned normalized rows are replaced before a retry, unique keys fence identity races, and aggregate counts are recomputed from retained events. This makes retry and restart idempotent.

`reprocessMqttEvents()` supports time, observer, subtopic, processing status, parser version, failed-only, bounded limit, and cursor filters. `reprocessPackets()` supports time, observer, decode status, decoder version, failed-only, and bounded limit filters. Reprocessing never changes `received_at_ms` and therefore never extends retention.

Internal metrics cover connectivity, receipts, processing failures, packet/observation and decoder totals, database failures, pending work, last receipt/write, retention runs/results, schema version, and process-observed schema resets. Logs include the affected event/topic/packet context where a failure occurs and never log cryptographic secrets.
