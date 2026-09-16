# MeshCore MQTT Broker

MeshCore MQTT Broker accepts authenticated MeshCore observer data and distributes it to configured MQTT subscribers over WebSocket. It is stateless: nothing is stored in a database; all MQTT and queue state lives in process memory and resets on restart.

## Features

- Ed25519/JWT observer authentication with machine-readable error codes
- Password-authenticated MQTT subscribers with three access levels
- In-memory MQTT routing (Aedes default persistence); retained `/neighbors` expire after 48 hours in MQTT
- Optional target MQTT forwarding and MeshCore.io advert upload (in-memory queues)
- Observe-only abuse logging; IP blocking handled by CrowdSec/Traefik

## Quick Start

A bootable `config.yaml` needs `mqtt.ws_port`, `mqtt.host`, `auth.expected_audience`, `subscribers.default_max_connections`, the `abuse.*` thresholds, and a non-empty `allowed_iata` allowlist (`iata.allowlist_enabled` must be `true`); see `config.yaml` and `CONFIGURATION.md`. There is no database to provision.

Copy `compose.yaml.example` to `compose.yaml`, then run:

```bash
docker compose up -d
```

Stateless: the config file is the ONLY mount (`./config.yaml:/run/configs/meshcore-mqtt-broker-config.yaml:ro`). There are no volumes, no `/data`, and nothing is persisted — the broker identity is fresh per process in memory, and Docker HEALTHCHECK probes `GET /status` with no credentials.

Terminate TLS before the container when using `wss://` (Traefik/CrowdSec in front); the example maps `ws://localhost:443` to the broker's plain HTTP/WebSocket listener on port `8883`.

## Clients

Observers authenticate with `v1_<PUBLIC_KEY>` and a signed JWT, then publish to `meshcore/<IATA>/<PUBLIC_KEY>/<SUBTOPIC>` and subscribe to `meshcore/<IATA>/<PUBLIC_KEY>/error` for machine-readable denial codes. IATA is the uppercase three-letter geographic MQTT ingress code. It is not a MeshCore region; MeshCore logical regions are represented by neighbor scopes. Subscribers authenticate with an account from `subscribers.users`.

Auth denials arrive as MQTT 3.1.1 CONNACK returnCode 5 (bare `5` on the wire — MQTT 3.1.1 has no reason string; codes are broker-log only, see `CONFIGURATION.md`). Publish denials arrive as the publish error and as JSON (`{ code, message, topic?, iata?, at }`) on the observer's own `/error` topic. See [OBSERVER_ERRORS.md](OBSERVER_ERRORS.md) for per-firmware access instructions.

Normal observer publishes require valid JSON whose `origin_id` matches the authenticated public key. Production enables the configured `allowed_iata` allowlist. The non-IATA `test` ingress is disabled by default and requires `iata.allow_test_ingress`. Publisher retain flags are removed except for exact `/neighbors` topics, which expire after 48 hours. The deprecated `/raw` subtopic is always discarded; publish raw MeshCore bytes inside `/packets` JSON instead.

## Operations

```bash
docker compose logs -f meshcore-mqtt-broker
docker compose exec --user bun meshcore-mqtt-broker mc-mqtt status
curl http://localhost:443/status
```

The broker exposes MQTT over WebSocket plus `GET /status` on the same listener. Status reports `{ status: "ok", storage: "stateless", instanceId, uptimeMs, observers, target, meshcoreIo }` (`instanceId` rotates on restart by design). It does not serve a dashboard, domain REST API, OpenAPI document, MCP endpoint, or frontend assets. `mc-mqtt status` queries the live broker via `GET /status`; `mc-mqtt observer list`, `mc-mqtt abuse ...`, and `mc-mqtt reset` explain that state is process-local/stateless.

## CI

Pull requests and pushes must pass `bun run check` (format + lint + typecheck) and `bun test`. There is no database-backed suite.

See [CONFIGURATION.md](CONFIGURATION.md), [OBSERVER_ERRORS.md](OBSERVER_ERRORS.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [SECURITY.md](SECURITY.md).
