# MQTT history ingest

## Runtime integration

The history collector is embedded in the one supported broker process. It observes the same accepted public `meshcore/#` traffic with full publisher-visible fields before subscriber-role filtering. It does not create a second MQTT connection, external worker, database, or reconnect loop; Aedes authorization itself is the connection and backpressure boundary.

For an accepted public publisher JSON publish, authorization awaits exactly one insertion into `mqtt_events` before Aedes is allowed to distribute it. A per-packet capture marker prevents Aedes' later `publish` event from inserting the same receipt again. A database write failure denies the publish and emits an explicit storage error, so loss is not silent. The durable table, rather than an in-memory queue, bounds pending work. One controlled processor claims rows transactionally.

The normalizer uses bounded-fair queueing: four newest (`fresh`) claims are followed by one oldest claim that has exceeded the 60-second freshness SLO (`backfill`). If no row is that old, the slot remains fresh. Thus a continuously non-empty old backlog advances at least once per five pending claims while at least 80% of capacity remains reserved for API freshness. Under normal load—defined as the five-minute normalization rate exceeding ingress—the freshness SLO is that newly received work starts within 60 seconds. Every claim still uses `FOR UPDATE SKIP LOCKED`, so concurrent diagnostic/test claimers cannot take the same row.

Queue health is sampled every 30 seconds and after an explicit drain. Metrics include pending count, oldest pending age, p50/p95/p99 pending age, five-minute ingest and normalization rates, estimated drain seconds when capacity exceeds ingress, and the most recent claimed ID/timestamp for both fresh and backfill lanes. Run the destructive, isolated million-row benchmark with `POSTGRES_TEST_URL`, `POSTGRES_HISTORY_QUEUE_BENCHMARK_CONFIRM=run-isolated-history-queue-benchmark`, and `bun run benchmark:history-queue`; it reports both directional plans and exercises continuous ingress across a complete 4:1 claim cycle.

Private `internal` and `serial` roots are excluded by default. Broker-generated retained clears, quarantined/orphaned wills, and other broker-internal publishes are control traffic and are not history receipts. Unknown public publisher subtopics are stored, classified, and left available for future reprocessing. MQTT redelivery creates a new receipt only when it passes through authorization as a newly accepted publish; the authorization/publish event pair itself never creates two rows.

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

The normalized history parser accepts `meshcore/<IATA>/<OBSERVER_PUBLIC_KEY>/<SUBTOPIC>`, where IATA is exactly three uppercase letters, plus nested public subtopics. It never treats `test` as normalized IATA. Authorization denies malformed or unconfigured IATA before history capture; an explicitly enabled compatibility `test` publish can be distributed but remains an unnormalized raw receipt. `OBSERVER_PUBLIC_KEY` is the uploader identity and is distinct from decoded source, destination, path, and advertised node identities.

All normal payloads are parsed as JSON. Invalid UTF-8, invalid JSON, origin mismatch, missing fields, bad hex, corrupt packets, unknown types, malformed neighbors, decoder failures, and verification failures become searchable `processing_errors`. Missing optional fields are not failures. Original bytes and raw/decoded JSON remain available.

## Supported public roots

- `status`: every receipt becomes an append-only `observer_status_events` row. Known identity/model/firmware fields are normalized; scalar metrics remain extensible by name; known radio parameters get historical rows.
- `neighbors`: every receipt becomes a snapshot. Scopes are trimmed and deduplicated. Unknown status text is retained. A receipt with matching observer, topic, payload hash, and reported timestamp is marked as a likely replay whether or not the predecessor was retained; calculated RF hearing time uses the original server receipt time rather than reconnect receipt time or the node's embedded clock.
- `packets`: packet bytes are extracted from the normal JSON envelope fields used by the broker (`raw`, `packet`, `payload`, or `data`). Upper/lowercase hex and an optional `0x` prefix are accepted. Packet SHA-256 covers decoded bytes, never the JSON envelope. RF fields belong to the observation.
- other public roots: raw MQTT receipt and JSON classification are retained without inventing a protocol model.

The MQTT subtopic `/raw` is deprecated and always discarded by the broker. It is not delivered, forwarded, stored, or processed. Publishers must place raw MeshCore bytes in the normal `/packets` JSON envelope; those bytes are authoritative packet material and are always preserved.

## Decoding and normalization

`MeshCorePacketDecoder` isolates the decoder implementation. The current adapter uses `@michaelhart/meshcore-decoder` and records its name, version, decode time, status, error, packet/payload type and complete decoded JSON. Supported status values are `not_attempted`, `decoded`, `partially_decoded`, `unknown_type`, `invalid_packet`, and `decoder_error`.

Verified adverts are the only source of trusted current node state (`name`, `role`, `location`, and `owner_public_key`). Which verified advert is the latest trusted observation is decided by ingest observation order (`received_at_ms`, then the event id); the embedded protocol timestamp is payload metadata and never governs canonical recency. Invalid/unverified adverts remain historical: they can update their own advert row, but they never set, overwrite, or clear trusted node state, and unverified-only evidence can never resolve a prefix identity. Prefix candidates cover one-, two-, and three-byte hashes; resolution succeeds only for a unique trusted (verified-evidence) candidate — zero trusted candidates stay `unresolved` and several trusted candidates stay `ambiguous`. Encrypted messages retain ciphertext and never attempt to bypass MeshCore encryption. Decoder fields without a normalized destination stay in `decoded_json`.

## Recovery and reprocessing

On startup, stale `processing` claims return to `pending`; failed events return only when they have no recorded processing errors, so poison payloads are not re-processed on every boot. Normalized writes occur in transactions after the raw receipt already exists. Event-owned normalized rows are replaced before a retry, unique keys fence identity races, observer IATA aggregates are maintained incrementally and recomputed only around a retry, and retention never expires an in-flight `processing` event. This makes retry, restart, and retention idempotent.

`telemetry`: RESPONSE payloads from the bundled decoder carry an encrypted envelope (destination hash, source hash, cipher MAC, ciphertext). Telemetry extraction requires decrypted payloads, so telemetry rows are produced only when a decoder emits `telemetry`/`values`; encrypted responses therefore produce no telemetry values in practice. The public telemetry tools return `no_data` in that case.

`reprocessMqttEvents()` supports time, observer, subtopic, processing status, parser version, failed-only, bounded limit, and cursor filters. `reprocessPackets()` supports time, observer, decode status, decoder version, failed-only, and bounded limit filters. Reprocessing never changes `received_at_ms` and therefore never extends retention.

Internal metrics cover connectivity, receipts, processing failures, packet/observation and decoder totals, database failures, pending work, last receipt/write, retention runs/results, schema version, and process-observed schema resets. Logs include the affected event/topic/packet context where a failure occurs and never log cryptographic secrets.

## PostgreSQL ingest benchmark

The CI ingest-benchmark gate builds the broker, then writes 101,633 accepted packet receipts/observations and 22,222 deduplicated packet identities, representing the target daily load. It uses `ApplicationDatabase` and `MqttHistoryService` with a deterministic decoder, so the measurement includes receipt storage, normalization, deduplication, and public-schema trigger projections. It verifies private receipt, packet, and observation counts plus public packet and observation counts, reports sustained receipt/observation and deduplicated-transmission rates, and fails below 2 receipts/observations per second or 1 deduplicated transmission per second.

The benchmark has no production default. It requires the explicit `POSTGRES_TEST_URL` test database, whose name must contain `test` or `bench`, plus explicit confirmation (`POSTGRES_INGEST_BENCHMARK_CONFIRM=run-isolated-ingest-benchmark`). It drops and recreates only `meshcore_private` and `meshcore_public` before and after the run. The gate is wired into CI; it is not part of the normal local script surface.

The benchmark role therefore needs only connection plus permission to create and drop the broker's two schemas on the dedicated test database.
