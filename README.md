# MeshCore MQTT Broker

This branch is the in-progress Rust migration of the stateless MeshCore MQTT
broker. It embeds RMQTT in one long-lived process and currently implements
MQTT 3.1.1/5 over WebSocket, observer and subscriber authentication,
publish/subscribe ACLs, stable observer error codes, and process-local
connection/observer ownership. MQTT retained messages are held only in RAM, according to the publisher's
RETAIN flag, with no automatic TTL or topic-count limit. Optional target MQTT
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
Status timestamps accept epoch milliseconds, RFC 3339/ISO datetimes, RFC 2822
dates and ISO datetimes without an offset. Offset-less values are interpreted
as UTC explicitly, matching the container deployment timezone.

Set `target_mqtt.url` to an `mqtt://` or `mqtts://` URL to forward exact
observer-owned `status`, `packets` and `neighbors` publishes. Forwarding is
QoS 0 and at-most-once: offline, full, timed-out and failed writes are dropped
and counted; there is no retry queue. Target forwarding preserves the MQTT RETAIN flag for authorized `status`,
`packets` and `neighbors` messages, with no synthetic TTL or capacity clears.
The external target may persist retained messages independently of our RAM.
Credentials embedded in the URL use URL percent-decoding (`+` remains `+`;
spaces use `%20`), or can be supplied by the dedicated username/password
settings.

Set `meshcore_io.enabled: true` to upload verified repeater, room and sensor
adverts. Requests are SHA-256/Ed25519 signed using either a 32-byte seed or a
64-byte MeshCore expanded private key. Transient network, HTTP 408/429 and 5xx
failures use bounded exponential retries; terminal responses complete without
retry. Ingress deduplication, radio state, jobs, retries, drops and counters are
all in memory and reset on restart. `test` ingress is never uploaded.

MQTT RETAIN follows the incoming flag for every authorized publish and Last
Will. RETAIN=1 stores/replaces a retained value, RETAIN=0 leaves any existing
retained value unchanged, and RETAIN=1 with a zero-length payload clears it.
There is no 10,000-topic limit or implicit 48-hour expiry. Stored messages
remain until replaced, cleared or the broker restarts. MQTT 5 explicit
Message Expiry Intervals are honored on a per-message basis. Storage is
process RAM only; the read-only config file is never written.
LIMITED subscribers receive their role-filtered JSON on both live delivery
and retained replay, while FULL_ACCESS and ADMIN receive the full payload.
Note that admin-only retained `serial/commands` messages can be replayed to a
reconnecting observer: administrators should clear any retained command once
it is no longer intended. The independent Target MQTT broker follows the
original retain bit and may retain data after this process restarts.

## Container

```bash
docker build -t meshcore-mqtt-broker:rust .
docker run --rm -p 8883:8883 \
  -v "$PWD/config.yaml:/run/configs/meshcore-mqtt-broker-config.yaml:ro" \
  meshcore-mqtt-broker:rust
```

The minimal image runs directly as unprivileged UID/GID `65532:65532`. Its
built-in healthcheck runs
`meshcore-mqtt-broker healthcheck`, which verifies that `/status` reports both
`status: "ok"` and `storage: "stateless"`. Compose keeps the 30-second stop
grace period used by the bounded shutdown sequence.
