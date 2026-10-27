# Rust migration

This branch replaces the Bun/Aedes implementation with one long-lived Rust
process embedding RMQTT. It remains a single, stateless broker: sessions,
retained packets, observer ownership, connection limits and forwarding queues
live only in process memory.

## Current phase

Status: **in progress**

- [x] Create the `rust-migration-rmqtt-foundation` branch.
- [x] Remove the TypeScript source, JavaScript tests and Node/Bun build files.
- [x] Replace `.gitignore` with Rust/Cargo rules and track `Cargo.lock`.
- [x] Add the Cargo application and pin the Rust toolchain.
- [x] Add RMQTT with its in-process retained-message and WebSocket features.
- [x] Port YAML parsing for the active MQTT, auth, subscriber and IATA settings.
- [x] Port the stable observer error codes and bounded JSON error payloads.
- [x] Port subscriber password authentication and process-local connection limits.
- [x] Port MeshCore Ed25519 JWT-style observer authentication.
- [x] Complete and unit-test the RMQTT authentication/ACL hook adapter.
- [x] Publish denial JSON directly to the denied observer connection on its
  own `/error` topic without leaking it to broad subscriber filters.
- [x] Normalize primary, secondary and opt-in test IATA routing consistently.
- [x] Port topic routing for public traffic and private `/internal`, `/serial`
  and observer-owned `/error` traffic.
- [x] Port admin, full-access and limited subscriber roles, including the
  limited JSON field projection used when forwarding packets and neighbors.
- [x] Port process-local observer session ownership: the newest authenticated
  connection owns the public key and replaces the older connection.
- [x] Add MQTT-over-WebSocket integration tests against the Rust process for
  accepted, denied, filtered and private messages.
- [x] Replace the Docker build and unprivileged entrypoint with Rust equivalents.
- [ ] Restore Docker HEALTHCHECK after the Rust `/status` endpoint is ported.
- [ ] Port retained-neighbor expiry and capacity behavior.
- [ ] Port target forwarding and the MeshCore.io in-memory upload queue.
- [x] Replace the README with Rust build, configuration and operations guidance.

## Latest verification

- `cargo fmt --all -- --check`
- `cargo check --all-targets`
- `cargo test --all-targets`
- `cargo clippy --all-targets -- -D warnings`
- MQTT-over-WebSocket integration tests exercise IATA normalization,
  subscriber-role delivery, secondary-IATA denial, private serial routing and
  observer session takeover.
- Manual WebSocket upgrade against the running RMQTT listener returned
  `101 Switching Protocols` with the `mqtt` subprotocol.

## Compatibility target for this phase

The first runnable milestone covers RMQTT, MQTT 3.1.1 over WebSocket,
authentication, publish/subscribe ACLs and machine-readable observer errors.
Authentication failures continue to use CONNACK return code 5; MQTT 3.1.1
cannot carry the textual error code. Publish failures retain their stable
`PUBLISH_*` code and are delivered as bounded JSON on the observer-owned error
topic.

The legacy JavaScript runtime is intentionally absent from this branch. Until
all checklist items required by deployment are complete, the branch is a
migration work branch and not a release candidate.
