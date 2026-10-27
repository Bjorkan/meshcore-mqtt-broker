# MeshCore MQTT Broker

This branch is the in-progress Rust migration of the stateless MeshCore MQTT
broker. It embeds RMQTT in one long-lived process and currently implements
MQTT 3.1.1/5 over WebSocket, observer and subscriber authentication,
publish/subscribe ACLs, stable observer error codes, and process-local
connection/observer ownership.

The old TypeScript/Bun/Aedes runtime is intentionally absent. See
[`RUST.md`](RUST.md) for the exact migration status and remaining work; this
branch is not a release candidate until that checklist is complete.

## Build and test

Rust 1.99 is pinned in `rust-toolchain.toml`.

```bash
cargo fmt --all -- --check
cargo check --all-targets
cargo test --all-targets
cargo clippy --all-targets -- -D warnings
cargo build --release --locked
```

## Run

The application discovers `config.yaml` in the working directory or the
standard Docker config paths. Set `MESHCORE_CONFIG` to select another file.

```bash
cargo run --locked --release
```

RMQTT listens for plain MQTT-over-WebSocket on `mqtt.host:mqtt.ws_port`.
Terminate TLS and enforce IP blocking in Traefik/CrowdSec. The broker remains
stateless; it has no database or data volume.

Observers authenticate as `v1_<64-hex-public-key>` using the existing
MeshCore Ed25519 JWT-style token, publish under
`meshcore/<IATA>/<PUBLIC_KEY>/<subtopic>`, and receive denial JSON on their own
`/error` channel. Subscriber accounts and roles come from `config.yaml`.

## Container

```bash
docker build -t meshcore-mqtt-broker:rust .
docker run --rm -p 8883:8883 \
  -v "$PWD/config.yaml:/run/configs/meshcore-mqtt-broker-config.yaml:ro" \
  meshcore-mqtt-broker:rust
```

The image runs as the unprivileged `broker` user. The HTTP `/status`
healthcheck and the remaining forwarding/retention integrations are tracked in
`RUST.md` and are not yet present in this migration phase.
