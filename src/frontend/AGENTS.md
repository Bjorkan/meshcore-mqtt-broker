# Frontend module instructions

This directory owns the shared plaintext listener in front of RMQTT. Follow
`src/AGENTS.md`; public TLS remains the responsibility of Traefik/CrowdSec.

- `server.rs` dispatches unauthenticated `GET /status`, rejects other HTTP
  routes and upgrades MQTT-over-WebSocket on `/` and `/mqtt` without changing
  MQTT bytes or subprotocol headers.
- `proxy.rs` trusts `X-Forwarded-For` only from configured proxy networks,
  walks the chain from the right and emits the RMQTT PROXY protocol source.
  Never trust a direct client's forwarding headers.
- `websocket.rs` enforces the configured complete-message limit across
  fragmented frames, preserves control frames and bounds header size/time.
- `status.rs` preserves the documented stateless JSON shape and must not
  expose credentials. `health.rs` validates that exact `/status` contract and
  owns portable shutdown-signal handling.
- Changes require focused HTTP/proxy/frame tests, MQTT-over-WebSocket wire
  tests and the container/Compose smoke checks. Keep request parsing bounded
  and do not add a second public listener.
