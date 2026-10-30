# MQTT policy

This module contains pure authorization and delivery decisions. It parses
MeshCore topics, validates publisher ownership and payload constraints, and
decides what each principal may publish, subscribe to, route, or receive.

It does **not** own RMQTT sessions, network I/O, or background tasks.

## Decision stages

```text
topic parsing
  ├─ publish authorization → canonical topic + original RETAIN flag
  ├─ subscribe authorization
  └─ route/delivery filtering → role-specific payload view
```

## Files

| File | Responsibility |
| --- | --- |
| [`topics.rs`](topics.rs) | Parses and canonicalizes `meshcore/<IATA>/<KEY>/<subtopic>`. |
| [`publish.rs`](publish.rs) | Enforces topic ownership, IATA, `origin_id`, payload, and reserved-route rules. |
| [`subscribe.rs`](subscribe.rs) | Authorizes observer and subscriber topic filters. |
| [`delivery.rs`](delivery.rs) | Applies routing visibility and LIMITED JSON projection. |
| [`mod.rs`](mod.rs) | Public policy API and denial-context helpers. |

Subscribe permission and final delivery visibility are separate decisions.
This distinction protects private routes and ensures LIMITED projection is
identical for live traffic and retained replay.

See the parent [MQTT overview](../README.md) and
[`AGENTS.md`](AGENTS.md) for policy invariants.
