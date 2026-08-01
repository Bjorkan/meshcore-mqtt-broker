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
- Persistent data across container restarts
- Optional forwarding to another MQTT broker
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

| Service             | Default address         |
| ------------------- | ----------------------- |
| Dashboard           | `http://localhost:8080` |
| MQTT over WebSocket | `ws://localhost:8883`   |

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

Region whitelisting is opt-in. With the default `IATA_whitelist: false`, every valid three-letter region is accepted and `allowed_regions` is ignored. See [Region configuration](#region-configuration).

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

## Dashboard

The dashboard at port `8080` provides a live view of:

- connected and recently seen observers
- active subscribers and subscriptions
- message and packet activity
- reported neighbor relationships
- rejected traffic and protection events
- target MQTT and MeshCore.io integration status

The dashboard is read-only. It does not change broker configuration. Its theme follows the operating system on first use; the light/dark control in the top bar stores an explicit browser-local preference.

## Configuration

Runtime configuration is stored in [`config.yaml`](config.yaml).

| Section           | Purpose                                      |
| ----------------- | -------------------------------------------- |
| `mqtt`            | WebSocket listener and payload limits        |
| `dashboard`       | Dashboard port                               |
| `branding`        | Public dashboard text and optional link      |
| `broker`          | Broker name and cache settings               |
| `auth`            | Observer JWT audience                        |
| `subscribers`     | Accounts, roles, and connection limits       |
| `allowed_regions` | Accepted MeshCore region codes               |
| `target_mqtt`     | Forwarding to another MQTT broker            |
| `meshcore_io`     | Publishing verified adverts to MeshCore.io   |
| `proxy`           | Trusted reverse-proxy settings               |
| `abuse`           | Traffic limits and abuse protection settings |

Restart the service after changing the configuration:

```bash
docker compose restart meshcore-mqtt-broker
```

Complete setting and validation documentation is in [`CONFIGURATION.md`](CONFIGURATION.md).

> **Upgrading:** Existing deployments that used `allowed_regions` for access control must add `IATA_whitelist: true`; otherwise the allowlist becomes inactive. Read [`MIGRATION.md`](MIGRATION.md) before updating a deployment that used region restrictions.

### Dashboard branding

The dashboard receives only these validated public values; credentials and other configuration are never serialized to the browser:

```yaml
branding:
  operator_name: MeshCore MQTT
  dashboard_title: MeshCore MQTT Broker
  dashboard_subtitle: Operations dashboard
  website_url: ""
```

`website_url` may be empty or use `http:`/`https:`.

### Region configuration

Whitelisting is disabled by default:

```yaml
IATA_whitelist: false
```

When enabled, only top-level entries are accepted. `secondary_region` is a comma-separated list of known but disallowed alternatives; clients using one are directed to its parent primary region.

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

The compatible list form (`allowed_regions: [MMX, STO]`) and object entries containing only `friendly_name` remain supported when `IATA_whitelist: true` is set. Codes are normalized to uppercase. With whitelisting disabled, malformed legacy `allowed_regions` content is ignored.

## Optional integrations

### Forward messages to another MQTT broker

Configure `target_mqtt.url` and credentials:

```yaml
target_mqtt:
  url: mqtts://broker.example.com:8883
  username: bridge-user
  password: replace-with-a-long-random-password
  reject_unauthorized: true
```

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

# Broker status
docker compose exec --user node meshcore-mqtt-broker mc-mqtt status

# Known observers
docker compose exec --user node meshcore-mqtt-broker mc-mqtt observer list

# CLI help
docker compose exec --user node meshcore-mqtt-broker mc-mqtt --help
```

Stop the container before copying `data/meshcore-mqtt-broker/` for a consistent backup. Restore the complete directory to the same mount location; the database path inside the container is intentionally fixed.

Images are available as `bjorkan/meshcore-mqtt-broker:latest`, `ghcr.io/bjorkan/meshcore-mqtt-broker:latest`, and immutable `sha-<12-character-commit>` tags.

## HTTP API

The read-only dashboard API exposes `GET /api/dashboard` and `GET /api/v1/observers/{publicKey}/status`. `regionLookup` is the canonical region metadata field. `countyLookup` remains as a deprecated compatibility alias for one release. See [`API_DEVELOPMENT.md`](API_DEVELOPMENT.md).

## Outbound connections

- Browser clients request light map tiles from OpenStreetMap or dark map tiles from CARTO when the map is opened. Providers and attribution are hard-coded; no private API key is used.
- Ordinary HTTP requests sent to the MQTT WebSocket port are redirected to `https://www.youtube.com/watch?v=dQw4w9WgXcQ`. This target is hard-coded and cannot be configured.
- MeshCore.io HTTP upload is disabled by default and controlled by `meshcore_io.enabled`.
- Target MQTT forwarding is disabled until `target_mqtt.url` is set.
- Region metadata is loaded only from `config.yaml` and performs no network or separate file access.

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

Technical documentation is available in [`ARCHITECTURE.md`](ARCHITECTURE.md) and [`API_DEVELOPMENT.md`](API_DEVELOPMENT.md).

## License

[MIT](LICENSE.md)
