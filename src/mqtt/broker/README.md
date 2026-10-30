# MQTT broker adapter

This module connects the pure [authentication](../auth/) and
[policy](../policy/) layers to RMQTT sessions, hooks, routing, and retained
storage.

## Runtime flow

```text
CONNECT   → authenticate → register observer ownership
SUBSCRIBE → policy check → RMQTT relation
PUBLISH   → policy + status guard → local routing/retention
                                  → Target MQTT / MeshCore.io
DELIVERY  → role filtering → client
```

Ordinary publishes and Last Wills share canonicalization, status freshness,
and integration forwarding. Their protocol-specific denial behavior remains
different: an ordinary observer publish can receive error JSON, while a denied
Last Will is redirected to an internal sink and never reaches subscribers.

## Files

| File | Responsibility |
| --- | --- |
| [`hooks.rs`](hooks.rs) | RMQTT authentication, ACL, publish, delivery, and cleanup hooks. |
| [`router.rs`](router.rs) | Applies principal visibility to RMQTT route relations. |
| [`retained.rs`](retained.rs) | RAM-only MQTT retained storage with explicit MQTT 5 expiry. |
| [`notifications.rs`](notifications.rs) | Observer denial delivery and tracked delayed disconnects. |
| [`status_guard.rs`](status_guard.rs) | Rejects older per-observer status timestamps. |
| [`heartbeat.rs`](heartbeat.rs) | Publishes the broker heartbeat immediately and periodically. |

Retained values have no implicit topic cap or automatic 48-hour expiry. They
are replaced or cleared only by incoming retained publishes, explicit message
expiry, or process restart.

See the parent [MQTT overview](../README.md) and
[`AGENTS.md`](AGENTS.md) for broker-runtime invariants.
