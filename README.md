<div align="center">

# MeshCore MQTT Broker

**A self-hosted MQTT endpoint for MeshCore observers, subscribers, and network monitoring.**

[![Build](https://github.com/bjorkan/meshcore-mqtt-broker/actions/workflows/build-image-broker.yml/badge.svg)](https://github.com/bjorkan/meshcore-mqtt-broker/actions/workflows/build-image-broker.yml)
[![Docker Pulls](https://img.shields.io/docker/pulls/bjorkan/meshcore-mqtt-broker?logo=docker&label=pulls)](https://hub.docker.com/r/bjorkan/meshcore-mqtt-broker)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE.md)

</div>

MeshCore MQTT Broker accepts authenticated data from MeshCore observers and makes it available to configured MQTT subscribers. It also includes a browser dashboard for following observers, subscribers, message activity, neighbors, and integrations.

## Features

- Ed25519/JWT authentication for MeshCore observers
- Password-authenticated MQTT subscriber accounts
- Three subscriber access levels
- Live dashboard for broker and network activity
- Public read-only HTTP V2 query API with the same 37 operations and schemas as MCP
- Locally served OpenAPI 3.1 contract and interactive Swagger UI
- Durable observer/application state and MQTT retained/session state across container restarts
- Optional best-effort forwarding of selected observer topics to another MQTT broker
- Optional upload of verified adverts to MeshCore.io
- Docker images for `linux/amd64` and `linux/arm64`

## Quick start

### 1. Clone the repository

```bash
git clone https://github.com/bjorkan/meshcore-mqtt-broker.git
cd meshcore-mqtt-broker
```

### 2. Create the Compose file and data directory

```bash
cp compose.yaml.example compose.yaml
mkdir -p data/meshcore-mqtt-broker
```

### 3. Configure authentication

Set the expected JWT audience in [`config.yaml`](config.yaml):

```yaml
auth:
  expected_audience: mqtt.example.com
```

Add at least one subscriber account:

```yaml
subscribers:
  default_max_connections: 2
  users:
    - username: mqtt-reader
      password: replace-with-a-long-random-password
      role: 3
      max_connections: 2
```

### 4. Start the broker

```bash
docker compose up -d
```

| Service             | Default address                 |
| ------------------- | ------------------------------- |
| Dashboard           | `http://localhost:443`          |
| Swagger UI          | `http://localhost:443/api/docs` |
| MQTT over WebSocket | `ws://localhost:443`            |

The Compose example publishes host port `443` to the broker's shared internal port `8883`. The Node.js listener itself is plain HTTP/WebSocket; deployments using `https://` and `wss://` must terminate TLS before forwarding traffic to the container.

```bash
docker compose logs -f meshcore-mqtt-broker
```

## Connecting clients

### MeshCore observers

Observers connect over MQTT WebSockets using their public key and a signed JWT.

```text
Username: v1_<PUBLIC_KEY>
Password: <SIGNED_JWT>
```

Observer topics use the following structure:

```text
meshcore/<REGION>/<PUBLIC_KEY>/<SUBTOPIC>
```

For example:

```text
meshcore/STO/<PUBLIC_KEY>/status
meshcore/STO/<PUBLIC_KEY>/neighbors
```

Region whitelisting is opt-in. With the default `IATA_whitelist: false`, publishes accept the case-insensitive `test` region or exactly three uppercase ASCII letters other than the reserved placeholder `XXX`; `allowed_regions` is ignored. See [Region configuration](#region-configuration).

### MQTT subscribers

Subscribers authenticate with an account from `subscribers.users` and can consume MeshCore data with any MQTT client that supports WebSockets.

```text
meshcore/#
```

| Role | Access                                                                     |
| ---: | -------------------------------------------------------------------------- |
|  `1` | Administrator access, including protected topics and serial commands       |
|  `2` | Full access to public MeshCore topics                                      |
|  `3` | Public MeshCore topics with selected radio and device details filtered out |

Normal observer publishes must contain valid JSON with an `origin_id` matching the authenticated public key. Observers may publish under their own `meshcore/{REGION}/{PUBLIC_KEY}/{SUBTOPIC}` namespace except for broker-owned `internal` and reserved `serial` paths. Incoming retain flags are removed except on the exact `/neighbors` subtopic, which is retained for 48 hours.

### Serial command extension

Role-1 subscribers may publish payloads up to 4096 bytes to `meshcore/{REGION}/{PUBLIC_KEY}/serial/commands`. The matching observer may subscribe only to its own command topic. Observers may publish a JWT-shaped, three-part base64url response of at most 4096 bytes on `serial/responses`. Other serial subtopics are reserved, and non-admin subscribers cannot receive serial traffic.

## Dashboard

The dashboard on the same address and port as MQTT provides a live view of:

- currently connected observers that have published at least one public message
- active subscribers and subscriptions
- message and packet activity
- reported neighbor relationships
- rejected traffic and protection events
- target MQTT and MeshCore.io integration status

The dashboard is read-only and does not change broker configuration. Its theme follows the operating system on first use; the light/dark control in the top bar stores an explicit browser-local preference. Previously seen inactive observers remain available through the V2 `list_observers` and `get_observer` operations and the CLI rather than the main dashboard list.

The MeshCore.io map requires WebGL2 in the browser. Its MapLibre 6 module and dedicated worker are bundled and served by the broker; only the configured map tile requests leave the browser.

The dashboard and APIs have no built-in authentication. Anyone who can reach the shared MQTT/HTTP port can retrieve observer public keys and activity, neighbor data, subscriber usernames/client IDs/subscriptions, protection events, integration status, map/history data, recent verified node adverts and region sightings, and redacted target-broker details. MQTT subscriber roles do not restrict HTTP access. Use network policy or an authenticated reverse proxy when this information is sensitive.

## Configuration

Runtime configuration is stored in [`config.yaml`](config.yaml).

| Section           | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `mqtt`            | Shared HTTP/WebSocket listener and limits    |
| `branding`        | Public dashboard text and optional link      |
| `broker`          | Broker name and cache settings               |
| `auth`            | Observer JWT audience                        |
| `subscribers`     | Accounts, roles, and connection limits       |
| `storage`         | Historical retention and cleanup batches     |
| `IATA_whitelist`  | Enables enforcement of `allowed_regions`     |
| `allowed_regions` | Accepted MeshCore region codes               |
| `target_mqtt`     | Forwarding to another MQTT broker            |
| `meshcore_io`     | Publishing verified adverts to MeshCore.io   |
| `proxy`           | Trusted reverse-proxy settings               |
| `healthcheck`     | Internal MQTT loopback check overrides       |
| `abuse`           | Traffic limits and abuse protection settings |

Restart the service after changing the configuration:

```bash
docker compose restart meshcore-mqtt-broker
```

Complete setting and validation documentation is in [`CONFIGURATION.md`](CONFIGURATION.md).

> **Upgrading:** This clean-install release changes the database schema for retention-bounded MQTT history. Broker startup permanently deletes an incompatible database and its sidecar files, then creates the current empty schema. Stop the old container and copy the bind-mounted directory before the first upgraded start if any existing state must be preserved. Existing deployments that used `allowed_regions` also retain whitelist enforcement when `IATA_whitelist` is absent. Read [`MIGRATION.md`](MIGRATION.md) before upgrading.

Historical storage is configured in `config.yaml`:

```yaml
storage:
  retention_days: 30
  cleanup_interval_minutes: 60
  cleanup_batch_size: 1000
```

The broker durably stores an accepted public MQTT event before distributing it, then asynchronously parses and normalizes status, neighbors, packet observations, decoded adverts/paths/traces/messages/telemetry, and processing errors. History is a cache since the latest schema reset and is retained by broker receipt time. The history layer does not support an MQTT `/raw` subtopic; packet bytes inside normal `/packets` JSON remain preserved. See [`DATABASE.md`](DATABASE.md) and [`INGEST.md`](INGEST.md).

### Dashboard branding

The dashboard HTML bootstrap embeds only these validated public values plus the whitelist status; credentials and the complete YAML document are never serialized. The separate `/api/dashboard` response contains the operational data described in [Dashboard](#dashboard).

```yaml
branding:
  operator_name: MeshCore MQTT
  dashboard_title: MeshCore MQTT Broker
  dashboard_subtitle: Operations dashboard
  website_url: ""
```

`website_url` may be empty or use `http:`/`https:` without embedded credentials.

### Region configuration

Whitelisting is disabled by default:

```yaml
IATA_whitelist: false
```

When enabled, only top-level entries are accepted. `secondary_region` is a comma-separated list of known but disallowed alternatives. A secondary publish is denied, and dashboard/API denial metadata records the expected primary region; the MQTT authorization error remains generic.

```yaml
IATA_whitelist: true

allowed_regions:
  MMX:
    friendly_name: Malmö Sturup och södra Skåne
    secondary_region: AGH, KID
  STO:
    friendly_name: Stockholmsområdet
    secondary_region: ARN, BMA
```

The compatible list form (`allowed_regions: [MMX, STO]`), empty object values, and object entries containing only `friendly_name` remain supported when `IATA_whitelist: true` is set. Configured codes are normalized to uppercase; publisher topic codes must already use uppercase. With whitelisting disabled, malformed legacy `allowed_regions` content is ignored.

## Optional integrations

### Forward selected messages to another MQTT broker

Configure `target_mqtt.url` and credentials:

```yaml
target_mqtt:
  url: mqtts://broker.example.com:8883
  username: bridge-user
  password: replace-with-a-long-random-password
  reject_unauthorized: true
```

Forwarding is best-effort QoS 0 and is limited to authenticated observer `status`, `packets`, `raw`, and `neighbors` publishes. Private, serial, nested custom, and other public subtopics are not forwarded. Ordinary messages are dropped when the target is unavailable or rejects them. `/neighbors` alone is forwarded as retained and gets a durable 48-hour clear deadline.

### Publish adverts to MeshCore.io

Enable the MeshCore.io integration:

```yaml
meshcore_io:
  enabled: true
  dry_run: false
```

## Operations

```bash
# Container status
docker compose ps

# Live logs
docker compose logs -f meshcore-mqtt-broker

# CLI help
docker compose exec --user node meshcore-mqtt-broker mc-mqtt --help
```

The container CLI always opens the fixed production database and accepts no database-path option:

| Command                           | Effect                                                                  |
| --------------------------------- | ----------------------------------------------------------------------- |
| `mc-mqtt status`                  | Probe Turso and show observer/protection counts                         |
| `mc-mqtt observer list`           | List known observers, latest region/activity, and message count         |
| `mc-mqtt abuse list`              | List active public protection states                                    |
| `mc-mqtt abuse remove PUBLIC_KEY` | Remove one protection state                                             |
| `mc-mqtt abuse clearall`          | Remove all protection states                                            |
| `mc-mqtt reset`                   | Interactively delete application/MQTT state while retaining the DB file |
| `mc-mqtt reset --force`           | Perform the same reset without prompting                                |

Run commands through Compose, for example:

```bash
docker compose exec --user node meshcore-mqtt-broker mc-mqtt status
docker compose exec --user node meshcore-mqtt-broker mc-mqtt observer list
```

Stop the container before copying `data/meshcore-mqtt-broker/` for a consistent backup. Restore the complete directory to the same mount location; the database path inside the container is intentionally fixed.

The schema is a clean-install schema, not a migration target. On startup, a marked database must match the exact current tables, columns, constraints, and indexes. The long-lived broker closes and permanently deletes an incompatible database plus known SQLite/Turso sidecars, then creates and validates a new empty current schema. It never migrates, repairs, imports, or rolls back old data. Read-only health and CLI opens do not delete files.

Images are available as `bjorkan/meshcore-mqtt-broker:latest`, `ghcr.io/bjorkan/meshcore-mqtt-broker:latest`, and commit-specific `sha-<12-character-commit>` tags.

## Public MCP V2

- Endpoint: `/mcp/v2`
- Access: Public
- Authentication: None
- Mode: Read-only

The stable MCP V2 Streamable HTTP endpoint exposes bounded normalized MeshCore history from the embedded Turso database. It shares the existing listener and process, accepts no credentials, and provides no mutation, generic SQL, generic MQTT payload, or filesystem tool. Every tool is also available as ordinary public JSON over `POST /api/v2/tools/{toolName}` with the same arguments, output, validation, limits, and safety policy. See [`MCP.md`](MCP.md) for the tool catalog, pagination, limits, and client examples.

## HTTP API

MQTT WebSocket upgrades, the MCP endpoint, the API, and the dashboard share `mqtt.host` and `mqtt.ws_port`. The API and dashboard remain separate HTTP handlers, and the dashboard reads `/api/dashboard` as an API client rather than owning API routes. Existing resource routes are read-only `GET`/`HEAD`; the public tool mirror uses read-only JSON `POST`; `/mcp/v2` accepts MCP protocol requests. Unsupported methods return `405`, and unknown paths return `404`.

| Route                           | Result                                                          |
| ------------------------------- | --------------------------------------------------------------- |
| `GET /api/dashboard`            | Operational snapshot used only by the dashboard                 |
| `GET /api/v2`                   | Discovery with all 37 public read-only operations               |
| `POST /api/v2/tools/{toolName}` | Run one MCP-equivalent operation with its JSON arguments object |
| `GET /api/openapi.json`         | Generated OpenAPI 3.1 contract with exact input/output schemas  |
| `GET /api/docs`                 | Interactive Swagger UI with a separate form for every operation |

The HTTP V2 operations are generated from the same registry as MCP. For example:

```bash
curl -X POST https://example.net/api/v2/tools/search_packets \
  -H 'content-type: application/json' \
  -d '{"region":"STO","min_rssi":-100,"limit":25}'
```

No authentication header, cookie, account, or API key is needed. Responses are the same structured content as MCP, including `{ data, meta }` pagination envelopes. `/api/v1` has been removed and returns HTTP `410`; migrate clients to the corresponding V2 operation listed in Swagger or [`MCP.md`](MCP.md).

## Outbound connections

- Browser clients request light map tiles from OpenStreetMap or dark map tiles from CARTO when the map is opened. Providers and attribution are hard-coded; no private API key is used.
- Ordinary HTTP requests on the shared listener serve the dashboard, API, or normal HTTP error responses; WebSocket upgrades continue to MQTT.
- MeshCore.io HTTP upload is disabled by default and controlled by `meshcore_io.enabled`.
- Target MQTT forwarding is disabled until `target_mqtt.url` is set.
- Configured MQTT region metadata is loaded only from `config.yaml`. The Sweden API geofence is bundled locally and performs no runtime network request.

## Development

```bash
npm ci
npm run dev
```

Run the project checks:

```bash
npm run check
npm test
```

Technical and project documentation:

- [`CONFIGURATION.md`](CONFIGURATION.md): complete YAML behavior and validation
- [`MIGRATION.md`](MIGRATION.md): manual configuration/API changes for existing deployments
- [`ARCHITECTURE.md`](ARCHITECTURE.md): runtime, storage, lifecycle, and data flow
- [`DATABASE.md`](DATABASE.md): historical schema, integrity, retention, and ER diagram
- [`INGEST.md`](INGEST.md): raw-first MQTT processing, decoding, recovery, and reprocessing
- [`MCP.md`](MCP.md): public MCP V2 tools, limits, query semantics, and safety boundary
- [`API_DEVELOPMENT.md`](API_DEVELOPMENT.md): dashboard/API contracts
- [`PRODUCT.md`](PRODUCT.md): supported product scope, users, and principles
- [`DESIGN.md`](DESIGN.md): implemented dashboard design system
- [`SECURITY.md`](SECURITY.md): vulnerability reporting and deployment considerations
- [`CONTRIBUTING.md`](CONTRIBUTING.md): development and pull requests
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md): data, icon, map, and bundled-library attribution
- [`LICENSE.md`](LICENSE.md): project source license

## License

Broker source code is available under the [MIT license](LICENSE.md). Third-party components and region data retain their respective licenses and attribution in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
