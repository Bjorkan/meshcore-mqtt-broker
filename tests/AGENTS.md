# Test and fixture instructions

These instructions apply under `tests/`; also follow the root `AGENTS.md`.

- `broker_core.rs` tests actual RMQTT behavior over MQTT-over-WebSocket: authentication, denied messages and codes, private routes, subscriber roles, retained replay, Last Will, takeover, heartbeat and stale status.
- Use real firmware-style Ed25519-JWT observers and Beacon/Paho-style FULL_ACCESS (role 2) subscribers where behavior depends on client details. Include **QoS 1 status PUBLISH/PUBACK**, packets/neighbors QoS 0, `meshcore/#` SUBSCRIBE at QoS 1 and relevant WebSocket paths `/` and `/mqtt`. A mere HTTP 101 upgrade is not sufficient.
- Retention follows **incoming RETAIN**: test status/packets/neighbors replay, replacement, nonretained updates leaving previous retained values unchanged, zero-byte retained clears, role-specific retained projection, explicit MQTT 5 expiry, and empty retained state after a freshly started broker. Do **not** expect a 10,000-topic eviction or automatic 48-hour clear.
- `target_network.rs` starts a real target MQTT broker. Request RETAIN=1 explicitly for any retained replay expectation. Test original retain flag, FIFO ordering, clears, and the distinction between local RAM and independently persistent Target MQTT.
- Keep `fixtures/` deterministic and synthetic. Cover old YAML config shapes, wire payload boundaries, JWT timing, retries and reconnects without production services or credentials.
- Avoid arbitrary wall-clock performance thresholds on shared runners. Clean up sockets, spawned broker tasks and listeners after each test; avoid inter-test port and state dependencies.

Run `cargo fmt --all -- --check`, `cargo check --all-targets --locked`, and `cargo test --all-targets --locked` when modifying integration tests. Do not treat skipped or unexecuted tests as successful.
