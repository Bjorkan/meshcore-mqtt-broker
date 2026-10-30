# Target MQTT bridge

This optional outbound bridge forwards authorized observer telemetry to a
separate MQTT broker. It is intentionally at-most-once and process-local: it
does not provide durable retries or coordinate retained state with the local
broker.

## Data flow

```text
authorized status / packets / neighbors
        → bounded FIFO
        → QoS 0 rumqttc publish
        → outgoing write callback
        → success or drop counter
```

The original MQTT `RETAIN` flag is forwarded unchanged. The remote broker may
therefore persist retained values independently after this process restarts.

## Files

| File | Responsibility |
| --- | --- |
| [`forwarding.rs`](forwarding.rs) | Exact topic allowlist, bounded FIFO worker, timeouts, counters, status, and shutdown drain. |
| [`connection.rs`](connection.rs) | rumqttc setup, credentials, mandatory TLS verification, reconnects, and event loop. |
| [`tracker.rs`](tracker.rs) | Pairs unlabelled QoS 0 outgoing events with submissions in strict FIFO order. |
| [`types.rs`](types.rs) | Public sink interface, typed errors, and status snapshot. |

Offline, full-queue, timed-out, and failed publishes are dropped and counted.
There is no retry queue, synthetic retained expiry, or generated clear.

See the [project README](../../README.md) for configuration and
[`AGENTS.md`](AGENTS.md) for ordering and shutdown invariants.
