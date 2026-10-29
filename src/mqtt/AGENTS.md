# MQTT module instructions

This directory owns authentication, topic/payload policy and broker adapters.
Follow `src/AGENTS.md`; wire-level tests remain under `tests/`.

- Authentication establishes principals and observer ownership. Policy decides
  publish, subscribe and delivery access. Broker hooks may compose those
  decisions but must not duplicate or weaken them.
- Preserve stable `AUTH_*`/`PUBLISH_*` codes, MQTT 3.1.1 rejection code 5,
  QoS behavior, Last Will checks, incoming RETAIN semantics and private topic
  visibility.
- Keep dependencies directed from broker adapters toward auth/policy. Auth and
  pure policy must not depend on RMQTT session/router implementation details.
- Any cross-directory MQTT change requires the real wire tests in
  `tests/broker_core.rs`, including takeover and role-filtered retained replay.
