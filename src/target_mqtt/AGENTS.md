# Target MQTT module instructions

This directory owns the optional outbound MQTT bridge. Follow `src/AGENTS.md`
and preserve the independently persistent remote broker boundary.

- `connection.rs` owns URL credentials, mandatory TLS verification, rumqttc
  reconnects and event-loop shutdown. Never log credentials or disable CA and
  hostname validation.
- `tracker.rs` pairs QoS 0 submissions with unlabelled outgoing callbacks in
  strict FIFO order. A timed-out receiver stays queued until its own callback;
  a request that never entered the channel removes only its own entry.
- `forwarding.rs` owns the bounded FIFO, exact topic allowlist, incoming
  RETAIN propagation, timeout/drop/success counters and graceful drain. Do not
  add retries, synthetic clears/expiry, persistence or parallel workers.
- Test disconnected admission, queue capacity, timeout cancellation, delayed
  callbacks, reconnect, shutdown and retained ordering. Run
  `tests/target_network.rs` for connection or forwarding changes.
