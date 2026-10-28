# MeshCore MQTT Broker

This branch is the in-progress Rust migration of the stateless MeshCore MQTT
broker. It embeds RMQTT in one long-lived process and currently implements
MQTT 3.1.1/5 over WebSocket, observer and subscriber authentication,
publish/subscribe ACLs, stable observer error codes, and process-local
connection/observer ownership. Exact `/neighbors` publishes are retained in
memory for 48 hours with a 10,000-topic LRU capacity. Optional target MQTT
forwarding and MeshCore.io advert uploads use bounded process-local queues and
counters.

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

Configuration stays compatible with deployed legacy files: `mqtt.host` may be
a hostname such as `localhost`, `allowed_iata` may be a plain list, and the
legacy `allowed_regions`/`IATA_whitelist` forms (with the `secondary_region`
and `maxConnections` aliases) keep working. Every active setting can also be
overridden with a `MESHCORE_<PATH>` environment variable, e.g.
`MESHCORE_MQTT_WS_PORT` or `MESHCORE_AUTH_EXPECTED_AUDIENCE`; a missing
`auth.expected_audience` key is a configuration error, so set it explicitly
(empty string disables audience validation). Payload limits must be greater
than zero. Subscriber names are trimmed, compared case-insensitively for
duplicates, and may not start with the observer-reserved `v1_` prefix.

```bash
cargo run --locked --release
```

RMQTT listens for plain MQTT-over-WebSocket on `mqtt.host:mqtt.ws_port`.
Terminate TLS and enforce IP blocking in Traefik/CrowdSec. The broker remains
stateless; it has no database or data volume.

The same external listener serves unauthenticated `GET /status`. Its response
contains the process identity, uptime, observer count and target/MeshCore.io
counters. The process handles SIGINT and SIGTERM by stopping admission,
closing MQTT sessions and bounding every integration shutdown step to five
seconds.
The shared HTTP/WebSocket frontend admits at most 4,096 concurrent
connections and applies a 10-second, 16-KiB header budget before proxying to
the embedded broker.

Observers authenticate as `v1_<64-hex-public-key>` using the existing
MeshCore Ed25519 JWT-style token, publish under
`meshcore/<IATA>/<PUBLIC_KEY>/<subtopic>`, and receive denial JSON on their own
`/error` channel. Subscriber accounts and roles come from `config.yaml`.

Set `target_mqtt.url` to an `mqtt://` or `mqtts://` URL to forward exact
observer-owned `status`, `packets` and `neighbors` publishes. Forwarding is
QoS 0 and at-most-once: offline, full, timed-out and failed writes are dropped
and counted; there is no retry queue. Only `neighbors` is retained at the
target, with the same 48-hour expiry and a 10,000-topic LRU bound.
Credentials embedded in the URL use URL percent-decoding (`+` remains `+`;
spaces use `%20`), or can be supplied by the dedicated username/password
settings.

Set `meshcore_io.enabled: true` to upload verified repeater, room and sensor
adverts. Requests are SHA-256/Ed25519 signed using either a 32-byte seed or a
64-byte MeshCore expanded private key. Transient network, HTTP 408/429 and 5xx
failures use bounded exponential retries; terminal responses complete without
retry. Ingress deduplication, radio state, jobs, retries, drops and counters are
all in memory and reset on restart. `test` ingress is never uploaded.

Only exact `meshcore/<IATA>/<PUBLIC_KEY>/neighbors` publishes are retained,
regardless of the observer's retain flag. All other client publishes are
nonretained. Refreshing a neighbor topic refreshes its LRU position and 48-hour
TTL; capacity eviction and expiry both clear the old retained value and notify
current subscribers with an empty payload. LIMITED subscribers receive their
role-filtered JSON on both live delivery and retained replay, while the full
payload remains available to FULL_ACCESS and ADMIN subscribers.
Last Wills pass the same topic/payload ACL as ordinary publishes. A denied
Will is not routed, and an accepted Will is always nonretained locally and on
the target, regardless of the MQTT retain bit.

## Container

```bash
docker build -t meshcore-mqtt-broker:rust .
docker run --rm -p 8883:8883 \
  -v "$PWD/config.yaml:/run/configs/meshcore-mqtt-broker-config.yaml:ro" \
  meshcore-mqtt-broker:rust
```

The image runs as the unprivileged `broker` user. Its built-in healthcheck runs
`meshcore-mqtt-broker healthcheck`, which verifies that `/status` reports both
`status: "ok"` and `storage: "stateless"`. Compose keeps the 30-second stop
grace period used by the bounded shutdown sequence.
