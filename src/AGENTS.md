# Rust source instructions

These instructions apply within `src/`; also follow the root `AGENTS.md`.

- `auth.rs`, `acl.rs` and `rmqtt_handler.rs` jointly implement observer/subscriber authentication, publish/subscribe checks, Last Wills and the RMQTT hooks. Do not alter only one code path and assume the others match.
- Preserve exact external topics, IATA normalization, `origin_id` validation, allowed reserved/private routes and stable observer error codes/payloads. Never allow unauthorized `/internal`, `/serial`, `/error` or `$SYS` visibility. Check observer takeover and stale-session delivery.
- ADMIN/FULL_ACCESS/LIMITED routing must project LIMITED payloads on **both live traffic and retained replay**, without modifying the stored full payload. Beacon uses FULL_ACCESS (role 2).
- `retained.rs`: retain **only if incoming RETAIN=1**; RETAIN=0 must not alter old retained state; RETAIN=1 plus zero-byte payload clears. Keep retained storage RAM-only, **without implicit 48-hour TTL or 10,000-topic eviction**; handle MQTT 5 explicit expiry.
- `target_bridge.rs`: forward only authorized telemetry subtopics in FIFO, with caller's original RETAIN flag. Do not add synthetic retained expiry, retained eviction, durable retries or persistent state. A remote Target broker owns its separate persistence.
- `meshcore_io.rs`: preserve packet/radio decoding, signature and HTTP payload schema, bounded dedup/retry handling and the security boundary between validated MQTT ingress and uploads. Avoid blocking the Tokio runtime and logging private credentials.
- `error.rs`: preserve machine-readable codes and notification JSON, including timestamp and optional diagnostic fields. Make behavior changes explicit and test them against the previous TypeScript wire format.
- `config.rs`: maintain supported deployed YAML aliases and `MESHCORE_*` overrides. The configuration file is read-only.
- `main.rs` and `production.rs`: keep MQTT-over-WebSocket and unauthenticated `GET /status` on the shared listener. TLS is terminated at the edge; outbound Target MQTT TLS must still validate certificates by default.

Add focused unit tests and actual network integration tests for changed contracts (QoS 0/1, retained replay and clear, Last Will, takeover, subscriber projection). Use the locked Cargo checks from root `AGENTS.md`.
