# MQTT policy instructions

This directory owns MeshCore topic parsing/canonicalization and pure PUBLISH
and SUBSCRIBE authorization. It must not own RMQTT sessions or async tasks.

- Preserve primary/secondary IATA normalization, observer public-key binding,
  `origin_id` checks, payload limits and intentionally allowed extension
  subtopics.
- Observers may access only their own private error/serial routes. Client
  publishes to broker-owned `/error`, `/internal` and `$SYS` stay forbidden.
- ADMIN, FULL_ACCESS and LIMITED have distinct subscribe/delivery rules.
  LIMITED projection must match for live traffic and retained replay.
- Subscribe permission and eventual delivery visibility are separate checks;
  do not infer one from the other.
- Topic/parser changes require allowed, denied, malformed and normalized tests
  plus role-routing wire tests. Never add a default-allow path for an unknown
  topic shape.
