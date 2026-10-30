# HTTP and WebSocket frontend

This module owns the single external plaintext listener shared by the status
endpoint and MQTT-over-WebSocket. Public TLS, rate limiting, and IP blocking
are handled upstream by Traefik/CrowdSec.

## Request routing

| Request | Result |
| --- | --- |
| `GET /status` | Returns the unauthenticated stateless health/status document. |
| WebSocket upgrade on `/` or `/mqtt` | Proxies MQTT bytes to the loopback RMQTT listener. |
| Other requests | Returns `404 Not Found` (or `405` for a non-GET status request). |

Trusted proxy addresses may supply `X-Forwarded-For`. The chain is walked from
right to left, and the resulting client address is passed to RMQTT through
PROXY protocol. Forwarding headers from all other peers are ignored.

## Files

| File | Responsibility |
| --- | --- |
| [`server.rs`](server.rs) | Bounded HTTP dispatch and WebSocket upgrade forwarding. |
| [`proxy.rs`](proxy.rs) | Trusted-proxy checks, forwarded-source selection, and PROXY protocol formatting. |
| [`websocket.rs`](websocket.rs) | Header limits and complete-message size enforcement across fragmented frames. |
| [`status.rs`](status.rs) | Builds the documented stateless status JSON without credentials. |
| [`health.rs`](health.rs) | Calls `/status`, validates its contract, and handles shutdown signals. |
| [`tests.rs`](tests.rs) | Focused HTTP, proxy-chain, upgrade, and frame-limit tests. |

See the [project README](../../README.md) for deployment guidance and
[`AGENTS.md`](AGENTS.md) for transport invariants.
