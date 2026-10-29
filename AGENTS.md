# Coding-agent instructions

This is `Bjorkan/meshcore-mqtt-broker`: one Rust process embedding RMQTT, migrated from TypeScript/Bun/Aedes. External MQTT and MeshCore.io behavior matters more than preserving internal implementation. Read `README.md` for deployment and `RUST.md` for migration progress.

## Scope and delivery

- Follow this file plus the nearest scoped `AGENTS.md` in `src/`, `tests/`, or `.github/`. Specific instructions supplement the root rules; explicit user requests take precedence.
- A review/comment-only task is **not** permission to modify code. Only implement code changes when authorized.
- For PR work, use the existing PR branch. **Never assume `main` is the delivery branch**, push directly to `main`, rewrite history, force-push, or merge without explicit authorization. Prefer one focused commit. Do not modify the unrelated `Bjorkan/meshat-api` repo.
- Add tests for behavioral changes, update relevant docs, report actual verification results and blockers. Do not call skipped, failed, or unexecuted checks successful.

## Runtime constraints

- One broker process and Compose container, behind Traefik/CrowdSec for public TLS, rate limiting and IP blocking. MQTT authentication/authorization remains the broker's responsibility.
- State is process-local: MQTT sessions, observer ownership, retained messages, Last Wills, counters, Target MQTT and MeshCore.io queues. No database, Redis, replicas, broker clustering, durable volume, coordination services or persistent broker identity.
- `config.yaml` is mounted **read-only**. `GET /status` is implemented and unauthenticated; the Docker healthcheck uses it. Never expose credentials in status/logs. The broker instance ID changes on restart.
- The runtime image is a minimal nonroot `scratch` container; the external Target `mqtts://` connection still requires working CA certificates and hostname validation.

## MQTT external contract

- Observer identity: `v1_<64-hex-public-key>` with MeshCore Ed25519 JWT-style authentication; owned publishes use `meshcore/<IATA>/<PUBLIC_KEY>/<subtopic>`. Preserve IATA rules, `origin_id` checks, topic ACLs, reserved subtopics, and stale-session ownership. `test` ingress needs explicit opt-in.
- `AUTH_*` and `PUBLISH_*` error codes must remain stable. MQTT 3.1.1 auth rejection uses CONNACK return code 5; publish errors may be delivered as JSON on the observer's own `/error` subscription. Never accept client publishes to broker-owned `/error`.
- Keep ADMIN/FULL_ACCESS/LIMITED topic visibility and field projection on both live delivery and retained replay. Beacon uses **FULL_ACCESS (role 2)**. Protect `/internal`, `/serial`, `/error`, and `$SYS` routes.
- **Deliberate change from the legacy mandatory-neighbors-retain policy:** use the **incoming MQTT RETAIN bit** for all authorized publishes and accepted Last Wills. RETAIN=1 with data stores/replaces; RETAIN=0 leaves any prior retained value untouched; RETAIN=1 with an empty payload clears. The local retained store lives only in RAM, with **no 10,000-topic cap or automatic 48-hour TTL**. Honor an explicit MQTT 5 Message Expiry Interval. Restart starts with an empty retained store.
- Target MQTT forwards its allowed telemetry topics with the **original retain flag**, no synthetic TTL or capacity clears. The remote Target broker may persist retained messages independently of local restarts. Retained admin `serial/commands` can replay after observer reconnect; treat authorization, safe handling and explicit clearing as security-sensitive.
- Compare with legacy TypeScript behavior for all non-deliberate external changes; preserve working observer/subscriber firmware contracts and add differential fixtures for changed wire behavior.

## AI-assisted Rust quality rules

- When the borrow checker rejects a design, revisit ownership and data flow
  before adding `.clone()`, reference-counting, interior mutability or
  artificial `'static` lifetimes. Borrow `&T`, `&mut T` or `&str` when no
  independent copy is needed; clones and `Arc` are justified for genuinely
  shared asynchronous state and task ownership.
- Prefer straightforward structs/functions over speculative traits, generic
  wrappers or additional crates. Check APIs against the versions in
  `Cargo.lock` and compile; do not invent crate methods.
- Handle recoverable errors using `Result`, `?` and contextual errors.
  Do not silently discard errors, hide them behind arbitrary defaults or
  introduce `unwrap()`/`expect()` on untrusted production inputs.
- Avoid introducing `unsafe`, `Box::leak`, lint suppressions or leaking
  tasks as shortcuts around compiler errors. If unsafe code is genuinely
  necessary, explain its safety invariants and add targeted tests.
- Do not hold a synchronous mutex guard across `.await`, do blocking I/O
  in an async worker, or spawn an unowned task. Identify who cancels, joins
  and stops workers during shutdown. See `src/AGENTS.md` for broker-specific
  exception handling.
- Never delete, weaken or selectively skip a failing test to make CI green.
  Prefer negative/edge/concurrent tests that prove the invariant in addition
  to happy-path tests (`tests/AGENTS.md`).

**OpenCode:** the checked-in `AGENTS.md` files are already OpenCode project
instructions; no duplicate `opencode.json` is needed. For an optional
read-only Rust design review, invoke `.opencode/agents/rust-review.md`.
That review is advisory, not a replacement for compilation or CI.

## Verification

The toolchain is pinned in `rust-toolchain.toml` (Rust 1.99.0). From the repository root:

```sh
cargo fmt --all -- --check
cargo check --all-targets --locked
cargo clippy --all-targets --locked -- -D warnings
cargo test --all-targets --locked
cargo test --doc --locked
cargo build --release --locked
docker compose -f compose.yaml.example config --quiet
```

For dependency/security policy changes, also run `cargo deny check advisories licenses sources` with the version pinned in `.github/workflows/dependency-security.yml`. CI runs host and image smoke tests. If local tools are unavailable, state that limitation and consult actual CI results; don't claim an unrun test passed.

## Documentation map

- `src/AGENTS.md` — Rust source invariants and sensitive integrations.
- `tests/AGENTS.md` — MQTT wire and regression-test requirements.
- `.github/AGENTS.md` — workflows, supply chain and smoke tests.
- `README.md` — installation, configuration and operation.
- `RUST.md` — migration checklist and verification status.
- `SECURITY.md` — responsible reporting and deployment posture.
- `THIRD_PARTY_NOTICES.md` — dependency notices.

Never commit secrets, private signing keys, live JWTs, or production configuration. Update the relevant human-facing documentation whenever behavior or deployment changes.
