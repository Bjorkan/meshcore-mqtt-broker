# MQTT broker-runtime instructions

This directory adapts RMQTT sessions, hooks, routing and retained storage to
the pure auth and policy modules. Follow the parent MQTT instructions.

- `hooks.rs` preserves hook ordering for authenticate, subscribe ACL,
  publish ACL, publish/Last Will processing, delivery filtering and session
  cleanup. MQTT 3.1.1 auth denial remains CONNACK code 5.
- Every ordinary and Last Will publish must pass the same topic, ownership,
  payload, status-freshness and integration-forwarding decisions. Differences
  are limited to protocol-specific denial handling.
- `retained.rs` is RAM-only: incoming RETAIN controls store/replace/clear,
  explicit MQTT 5 expiry is honored, and there is no implicit TTL or topic
  cap. LIMITED projection happens at delivery, never by mutating stored data.
- `router.rs` applies policy to RMQTT relations, including stale observers
  receiving only their own error notification. `status_guard.rs` preserves
  per-key timestamp ordering and bounded process-local state.
- Denial notification tasks must be tracked, aborted and joined on shutdown.
  Never hold a synchronous lock across `.await` or detach session-kick tasks.
- Changes require focused unit tests and `tests/broker_core.rs` coverage for
  QoS 0/1, Last Will, takeover, private routes, retained replay/clear/expiry
  and role projection.
