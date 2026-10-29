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

## Ownership, errors and async code (AI review checklist)

- Prefer borrowing for function parameters and small scoped mutations.
  Before adding a clone, identify the other owner that genuinely requires
  independent data (for example a spawned Tokio task or a queued message).
  Avoid wrapping single-owner state in `Arc<Mutex<_>>` just to satisfy the
  borrow checker; also do not remove necessary existing cross-task sharing.
- Keep `std::sync::Mutex` critical sections short and wholly synchronous.
  **Drop the guard before every `.await`**, including early-return and error
  paths. A Tokio mutex is appropriate only when work must be serialized
  across suspension points; moving the lock type does not fix poor ownership.
  Preserve the Target MQTT FIFO worker's message order and callback pairing.
- Do not block Tokio workers with file/network I/O or expensive CPU work.
  Use async APIs or isolate genuinely blocking operations with documented
  ownership and shutdown behavior. Avoid unnecessary `async fn` wrappers.
- Never paper over parsing/authentication/network failures with
  `unwrap_or_default()`, ignored `Result` or generic success values. Distinguish
  malformed client input, unavailable integrations, timeouts and stopping.
  Keep errors mapped to stable MQTT codes and observable counters.
- `unwrap()`/`expect()` are acceptable for proven internal invariants
  when the invariant is explained; they are not appropriate for recoverable
  network, config, JWT, packet or HTTP failures. Review lock poisoning when
  using `std::sync::Mutex::lock().unwrap()` on production paths.
- Avoid `unsafe`, `Box::leak`, new `#[allow(...)]` attributes and artificial
  `'static` lifetimes as compiler workarounds. Any necessary unsafe block
  needs an explicit safety invariant and a focused test.
- Introduce new traits, boxed trait objects or dependencies only for a
  demonstrated boundary (for example the already-existing Target sink
  and HTTP poster test doubles); do not add abstractions speculatively.
