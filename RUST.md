# Rust migration

This branch replaces the Bun/Aedes implementation with one long-lived Rust
process embedding RMQTT. It remains a single, stateless broker: sessions,
retained packets, observer ownership, connection limits and forwarding queues
live only in process memory.

## Current phase

Status: **in progress**

- [x] Keep registry credentials out of pull-request jobs; authenticated image
      scanning and publishing run only for trusted repository events.
- [x] Build immutable AMD64/ARM64 release images once, scan each exact digest,
      and promote only those verified digests into release manifests.
- [x] Gate dependency changes and run a weekly scheduled RustSec, license and
      source-policy check with pinned `cargo-deny` 0.20.2.

- [x] Create the `rust-migration-rmqtt-foundation` branch.
- [x] Remove the TypeScript source, JavaScript tests and Node/Bun build files.
- [x] Replace `.gitignore` with Rust/Cargo rules and track `Cargo.lock`.
- [x] Add the Cargo application and pin the Rust toolchain.
- [x] Add RMQTT with its in-process retained-message and WebSocket features.
- [x] Port YAML parsing for the active MQTT, auth, subscriber and IATA settings.
- [x] Keep deployment compatibility: `MESHCORE_*` environment overrides,
      hostname listeners, list-form `allowed_iata`, legacy `allowed_regions`/
      `IATA_whitelist`, and the `secondary_region`/`maxConnections` aliases,
      with fixtures loading the legacy shapes.
- [x] Port the stable observer error codes and bounded JSON error payloads.
- [x] Port subscriber password authentication and process-local connection limits.
- [x] Port MeshCore Ed25519 JWT-style observer authentication.
- [x] Require `auth.expected_audience` explicitly: a missing key is a config
      error, an explicit empty string disables audience validation, and
      whitespace-only values are rejected.
- [x] Complete and unit-test the RMQTT authentication/ACL hook adapter.
- [x] Route denial JSON through ordinary topic matching: observers receive it
      via their own `/error` subscription, admins on `meshcore/#` keep full
      visibility, and limited/full roles stay protected.
- [x] Normalize primary, secondary and opt-in test IATA routing consistently.
- [x] Port topic routing for public traffic and private `/internal`, `/serial`
      and observer-owned `/error` traffic.
- [x] Port admin, full-access and limited subscriber roles, including the
      limited JSON field projection used when forwarding packets and neighbors.
- [x] Port the broker `heartbeat/` publish with the legacy topic, payload and
      30 s interval, delivered immediately at start and then periodically.
- [x] Port the stale-status guard: per-public-key device timestamps reject
      older status messages with `PUBLISH_STALE_STATUS`, accept equal
      timestamps and skip missing/unparseable values, in bounded process memory.
- [x] Port denial IATA recovery for observer error routing: prefer the denial's
      own IATA, then the denied topic's IATA, then the XXX placeholder.
- [x] Route denial notifications through ordinary topic matching so observers
      receive them via their own error subscription and admin meshcore/#
      subscribers keep full visibility, while limited/full roles stay
      protected; closing denials defer the disconnect behind a flush window.
- [x] Port process-local observer session ownership: the newest authenticated
      connection owns the public key and replaces the older connection.
- [x] Add MQTT-over-WebSocket integration tests against the Rust process for
      accepted, denied, filtered and private messages.
- [x] Migrate GitHub Actions from Bun to locked Cargo checks and preserve a
      smoke boot that verifies the Rust MQTT-over-WebSocket handshake.
- [x] Replace the Docker build and unprivileged entrypoint with Rust equivalents.
- [x] Restore unauthenticated `GET /status` on the shared external listener,
      the built-in Docker HEALTHCHECK and Compose health settings.
- [x] Port exact-neighbor retention with a 48-hour TTL, 10,000-topic LRU
      capacity, clear notifications and role-filtered retained replay.
- [x] Port target MQTT forwarding for exact observer-owned `status`, `packets`
      and `neighbors` topics, including QoS 0 write callbacks, offline/timeout/
      capacity drop counters and retained-neighbor TTL/LRU clearing.
- [x] Serialize target MQTT publishes through one bounded FIFO worker queue so
      retained neighbor publishes reach the target in offer order.
- [x] Pin target QoS 0 callbacks to their publish: submissions are serialized
      and the eventloop completes callbacks in strict FIFO, with failed
      channel submissions removed by id.
- [x] Make target publish timeouts cancellation-safe: abandoned callbacks stay
      queued and are consumed by their own Outgoing event, so a later event
      can never complete a wrong callback; timeouts drop the message and the
      worker continues.
- [x] Port the stateless MeshCore.io ingress/upload runtime with bounded
      deduplication and queues, verified adverts, 32-byte seed and 64-byte
      expanded-key signatures, response classification, exponential retries,
      drops and queue counters.
- [x] Restore the ~1 s ingress retry backoff between failed attempts and drop
      permanently unparseable ingress topics immediately.
- [x] Replace the README with Rust build, configuration and operations guidance.
- [x] Handle SIGINT/SIGTERM with bounded shutdown of listeners, MQTT sessions,
      retained expiry, MeshCore.io workers and target MQTT forwarding.
- [x] Close the migration-review identity and boundary gaps: subscriber names
      cannot shadow `v1_` observers or collide by case, JWT time arithmetic is
      saturating across all `i64` values, and zero payload limits are rejected.
- [x] Decode target URL credentials as URL components without treating `+` as
      a form-space, and redact subscriber, target and signing secrets from all
      configuration `Debug` output.
- [x] Make retained and integration eviction deterministic with insertion-
      ordered maps and O(1) oldest-entry selection; failed retained clears
      preserve their obligation for retry instead of silently losing it.
- [x] Enforce Last Will ACL and payload validation explicitly around RMQTT's
      Will path and black-hole denied Wills. Accepted exact neighbor Wills use
      the legacy mandatory-retain policy locally and on target MQTT.
- [x] Apply the stale-status guard to accepted status Last Wills before broker
      routing, target forwarding or MeshCore.io ingress.
- [x] Match deployed JavaScript status-date inputs: RFC 3339, RFC 2822,
      date-only and offset-less ISO datetimes are accepted, with naive values
      explicitly interpreted as UTC.
- [x] Bound stale-status history with deterministic legacy insertion-order
      eviction instead of `HashMap` iteration order.
- [x] Bound the shared HTTP/WebSocket frontend to 4,096 concurrent connections
      and eliminate its internal ephemeral-port TOCTOU by retaining a
      `SO_REUSEPORT` reservation until RMQTT has bound the same address.
- [x] Make MeshCore.io shutdown cooperative: in-flight HTTP work is cancelled,
      workers are joined, and full-map cleanup runs in a dedicated periodic task
      instead of on every ingress attempt
      offer while holding the synchronous state lock.

## Latest verification

- `cargo fmt --all -- --check`
- `cargo check --all-targets`
- `cargo test --all-targets`
- `cargo clippy --all-targets -- -D warnings`
- MQTT-over-WebSocket integration tests exercise IATA normalization,
  subscriber-role delivery, secondary-IATA denial, private serial routing and
  observer session takeover.
- Heartbeat integration tests exercise the immediate-at-start and periodic
  `heartbeat/` publishes, per-role visibility and observer subscription denial.
- Stale-status integration and unit tests exercise newer/equal/older device
  timestamps, skipped missing/invalid values, per-key isolation, TTL expiry
  and the `PUBLISH_STALE_STATUS` denial reaching only the observer error topic.
- Retained-message integration tests exercise TTL clear/replay prevention, LRU
  refresh/eviction, non-neighbor retain stripping and per-role payload views.
- Target integration tests exercise the exact forwarding policy, offline and
  queue drops, write-success counters, retained TTL/LRU behavior and failed
  clear preservation.
- MeshCore.io tests verify both signing-key formats, retry/completion/drop
  accounting, bounded deterministic deduplication, normalized radio state and
  cancellation of an in-flight HTTP upload during shutdown.
- Boundary tests cover exact/+1 JSON and serial payload sizes, JWT `i64`
  extremes/expiry/future skew, target credentials containing `+`, `%2B`, `%20`
  and Unicode, and case-insensitive subscriber identity collisions.
- Last Will broker tests cover reserved-topic denial, takeover suppression,
  ordinary live delivery and retained neighbor replay/target forwarding.
- The production smoke test probes `/status`, runs the image healthcheck
  command, upgrades MQTT-over-WebSocket and verifies clean SIGTERM exit.
- Manual WebSocket upgrade against the running RMQTT listener returned
  `101 Switching Protocols` with the `mqtt` subprotocol.

## Compatibility target for this phase

The current runnable milestone covers RMQTT, MQTT 3.1.1 over WebSocket,
authentication, publish/subscribe ACLs and machine-readable observer errors.
Authentication failures continue to use CONNACK return code 5; MQTT 3.1.1
cannot carry the textual error code. Publish failures retain their stable
`PUBLISH_*` code and are delivered as bounded JSON on the observer-owned error
topic.

Accepted publishes from the current observer session owner now feed the two
optional integrations. Target MQTT remains at-most-once with no retry queue;
MeshCore.io retries only transient network, 408/429 and 5xx failures in bounded
process memory. Both integrations and every counter reset on restart.

The legacy JavaScript runtime is intentionally absent from this branch. Until
all checklist items required by deployment are complete, the branch is a
migration work branch and not a release candidate.
