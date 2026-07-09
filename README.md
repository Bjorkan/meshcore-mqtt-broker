# meshcore-mqtt-broker

A WebSocket-based MQTT broker with MeshCore public key authentication.

Docker image: `bjorkan/meshcore-mqtt-broker`

## Features

- **WebSocket MQTT**: Uses MQTT over WebSockets (not MQTT over TCP protocol)
- **Public Key Authentication**: Clients authenticate using their MeshCore public keys
- **Topic Authorization**: Controls access to meshcore/* topics

## Authentication

### Username Format
```
v1_{UPPERCASE_PUBLIC_KEY}
```

Example: `v1_7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400`

### Password Format
The password is a JWT-style authentication token signed with your MeshCore Ed25519 private key using orlp/ed25519, which is used in the MeshCore firmware and in the `@michaelhart/meshcore-decoder` library's `createAuthToken` function.

```javascript
import { createAuthToken } from '@michaelhart/meshcore-decoder';

const privateKey = 'YOUR_64_BYTE_PRIVATE_KEY_HEX'; // MeshCore format
const publicKey = 'YOUR_32_BYTE_PUBLIC_KEY_HEX';

const password = await createAuthToken(
  {
    publicKey: publicKey,
    aud: 'mqtt.yourdomain.com', // Must match auth.expected_audience in config.yaml
    iat: Math.floor(Date.now() / 1000),
    // Optional: add expiration
    // exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
  },
  privateKey,
  publicKey
);
```

The token format is: `header.payload.signature` where the signature is verified using Ed25519.

## Configuration

Runtime configuration is read from `config.yaml`. The file is only read by the broker and is never written to, so it can be mounted as a Docker Swarm config or another read-only config source. By default the broker looks for `config.yaml`, `broker/config.yaml`, `/run/configs/meshcore-mqtt-broker-config.yaml`, and `/run/configs/config.yaml`.

Edit `config.yaml` for runtime settings:

```yaml
mqtt:
  ws_port: 8883
  host: 0.0.0.0
auth:
  expected_audience: mqtt.yourdomain.com
broker:
  kv_url: redis://valkey:6379
subscribers:
  default_max_connections: 2
  users:
    - username: admin
      password: your-secure-password-here
      role: 1
      max_connections: 10
allowed_regions:
  JKG:
    friendly_name: Jönköping och södra Vätternområdet
```

**Subscribe-only users** can read messages but cannot publish. They're useful for monitoring, debugging, and administrative dashboards.

The broker-integrated target forwarding does not require a local subscriber account.

Numeric configuration is validated at startup. Ports must be in the range `0..65535`; payload sizes, time windows, counters, and connection limits must be positive integers unless `config.yaml` notes otherwise. Invalid numeric values stop the broker before it starts listening.

`mqtt.ws_max_payload_bytes` is the early WebSocket/MQTT transport frame limit. Frames above this are closed before they are passed into Aedes. `mqtt.json_publish_max_bytes` is the later application limit for normal JSON publish payloads. `abuse.max_packet_size` is used by abuse detection for raw LoRa packet data when a JSON message includes a `raw` field.

**Subscriber Roles**:
- **Role 1 (Admin)**: Full access including `/internal` topics (contains PII), `$SYS/*` system topics, and admin-only `/serial/commands` publishing
- **Role 2 (Full Access)**: Access to all public topics with no data filtering, cannot access `/internal` or `$SYS/*`
- **Role 3 (Limited)**: Access to public topics only with sensitive data filtered (SNR, RSSI, score, stats, model, firmware_version removed from messages)

## Installation

```bash
npm install
```

## Usage

### Development
```bash
npm run dev
```

### Production
```bash
npm run build
npm start
```

## Connecting Clients

### JavaScript/Node.js Example

```javascript
const mqtt = require('mqtt');
const { createAuthToken } = require('@michaelhart/meshcore-decoder');

const privateKey = 'YOUR_64_BYTE_PRIVATE_KEY_HEX'; // MeshCore format
const publicKey = '7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400';
const clientId = 'meshcore_test_client';

async function connect() {
  // Generate auth token
  const password = await createAuthToken(
    {
      publicKey: publicKey,
      aud: 'mqtt.yourdomain.com', // Must match auth.expected_audience in config.yaml
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 86400 // 24 hours
    },
    privateKey,
    publicKey
  );

  const client = mqtt.connect('ws://localhost:8883', {
    clientId: clientId,
    username: `v1_${publicKey}`,
    password: password
  });

  client.on('connect', () => {
    console.log('Connected!');
  });

  const topic = `meshcore/test/${publicKey}/packets`;
  client.publish(topic, JSON.stringify({ origin_id: publicKey, raw: '00' }), { retain: false });
}

connect();
```

## Topics

Publishers can only publish to topics with the following format:

- `meshcore/{IATA_CODE}/{PUBLIC_KEY}/{subtopic}`

Examples:
- `meshcore/SEA/7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400/packets`
- `meshcore/SEA/7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400/status`
- `meshcore/SEA/7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400/raw`
- `meshcore/SEA/7E7662676F7F0850A8A355BAAFBFC1EB7B4174C340442D7D7161C9474A2C9400/serial/responses`

Where:
- `{IATA_CODE}` must be a 3-letter region code listed under `allowed_regions` in `config.yaml`, or `test` for testing
- `{PUBLIC_KEY}` must be the full 64-character hex public key (matching your authenticated public key)
- `{subtopic}` can be any upstream-compatible observer subtopic, except documented broker-owned/reserved paths such as `/internal` and unsupported `/serial/*` topics. The broker extension `serial/responses` is allowed.

The broker accepts MQTT retained publishes from clients for MeshCore observer compatibility, but always strips `retain` before processing. Clients cannot create retained MQTT state.

**Important**: The `/internal` subtopic is broker-owned, ADMIN-only, and contains PII (Personally Identifiable Information) from JWT payloads. Publishers cannot write `/internal`; the broker publishes it itself as non-retained live telemetry (no retained internal state). `/serial/commands` is admin-only and may only be written by role 1 subscribers.

All normal JSON publishes must be valid JSON and contain an `origin_id` field matching your authenticated public key. A `raw` field is accepted and used by abuse detection when present, but it is not required by default for upstream-compatible observer traffic. JSON publishes are rejected before parsing if they exceed `mqtt.json_publish_max_bytes`. `serial/responses` is an opaque JWT-shaped payload, but it is still checked for maximum size and abuse/rate policy.

Abuse detection runs for publisher JSON messages and `serial/responses`. With `abuse.enforcement_enabled=false`, clients that would be denied are marked as `would_mute` in `/internal` trust state and shown as "Varnas" in operator views while their traffic is still allowed. With `abuse.enforcement_enabled=true`, muted publishers are rejected by the broker and shown as "Nekad".

Publishers may switch freely between allowed IATA/region codes such as `GSE` and `GOT` without being muted. `abuse.max_iata_changes_24h` is an observation threshold for logs and `/internal` trust state only; it does not reject otherwise valid publishes. Publishes to an invalid or unlisted IATA code are denied immediately and shown in the dashboard's "Nekade" list, but that denial is not an abuse ban by itself.

Abuse denials are time-limited when enforcement is enabled. The first enforced denial lasts 1 hour. The second and all later enforced denials for the same public key last 6 hours. When the denial expires, the broker automatically allows the publisher again and refills its token bucket. The `/internal` trust state keeps the upstream-compatible field names `mutedAt`, `mutedUntil`, `muteReason`, and `abuseBlockCount`.

Publishers are publish-only except that they may subscribe to their own exact `meshcore/{IATA_CODE}/{PUBLIC_KEY}/serial/commands` topic in an allowed region. Non-admin subscribe-time restrictions are an intentional fork behavior: role 2 and role 3 subscribers may subscribe only to public MeshCore topics and documented broker topics such as `heartbeat/`; the runtime `docker_health` user is additionally allowed to publish and subscribe only to its internal `healthcheck/docker_health` loopback topic. Broker-owned `/internal`, `/serial/*`, and `$SYS/*` messages are also blocked by forward-time filtering for non-admin subscribers.

## Target broker forwarding

The broker can publish its locally claimed observer traffic to another MQTT broker. Set these values in `config.yaml`:

```yaml
target_mqtt:
  url: mqtts://mqtt.example.com:8883
  username: ""
  password: ""
```

Forwarding is disabled when `target_mqtt.url` is empty. The target MQTT client ID follows the broker runtime ID, so each broker replica has a distinct target connection. A broker forwards only messages from publisher clients whose observer public key it has claimed in Valkey; other replicas are responsible for the observers they have claimed. Forwarded publishes keep the original `meshcore/{IATA}/{PUBLIC_KEY}/{subtopic}` topic and payload, but are always sent with `retain: false`.

## Docker Builds

```bash
docker build -t bjorkan/meshcore-mqtt-broker .
```

## Deployment

### Docker Swarm orchestration with Valkey

The broker always runs in Valkey-backed orchestration mode. `broker.kv_url` is required even when you run a single broker replica. Valkey uses the Redis protocol, so the URL normally starts with `redis://`.

The broker uses Valkey for Aedes MQTT cluster routing/persistence, subscriber `maxConnections` counting, runtime abuse/trust state, and broker instance readiness across replicas. This lets publishers and subscribers land on different containers while still sharing MQTT delivery and policy state. The same path is used for one replica and ten replicas.

Each broker process generates a fresh runtime ID on startup, for example `Broker-42GH`. Set `broker.name` to change only the prefix before the dash, for example `Meshat-HD21`; the ID suffix is always chosen by the broker. The generated ID is written to a local runtime file so `mc-mqtt`, the healthcheck, dashboard metrics, Valkey readiness, observer claims, and target bridge client ID all refer to the same runtime. If Valkey already has a fresh readiness key for the generated broker ID, startup fails and the container exits so Swarm/Kubernetes can start a replacement with a new generated ID.

The intentional fork MQTT contract is unchanged in orchestration mode: client retained publishes are still stripped, publisher topic and payload validation stays the same, and non-admin subscriber restrictions still apply.

Runtime abuse decisions use Valkey-locked trust state so rate, duplicate, mute, and shadow-mode state is shared across replicas. There is no local abuse database. Broker-owned Valkey values include `lastUpdatedByInstance` and `lastUpdatedAt` metadata so operators can see which replica last wrote the state. Runtime Valkey writes are TTL-bound: readiness and subscriber connection keys are short lived, trust state expires after 90 days of inactivity, locks expire after a few seconds, and Aedes outgoing packet persistence expires after 24 hours.

Observer connection state is claim-based. A publisher is treated as connected only by a broker that owns, or can take, the Valkey observer claim for that public key. Brokers renew claims while observers remain connected, reject publisher traffic if the claim cannot be owned, and release the claim when the final local connection for that observer closes. Dashboard observer lists also require the matching claim owner. Friendly observer names learned from status messages are shared through Valkey while the observer is claimed so logs and dashboard labels stay consistent across broker replicas. When an observer is no longer claimed, non-abuse runtime observer state such as the claim, shared friendly name, and active observer snapshots is cleared; abuse/trust state remains on its longer TTL.

The dashboard API always builds its public snapshot from Valkey reads after the responding broker has published its current runtime state. It does not use the responding process' local memory as a fallback for broker totals, observer lists, or recent publishes, so every broker should return the same cluster view for the same Valkey state.

Minimal Swarm service shape:

```yaml
services:
  broker:
    image: bjorkan/meshcore-mqtt-broker
    deploy:
      replicas: 3
    configs:
      - source: broker_config
        target: /run/configs/meshcore-mqtt-broker-config.yaml
    networks:
      - broker_net

  valkey:
    image: valkey/valkey:9-alpine
    command: ["valkey-server", "--appendonly", "yes"]
    volumes:
      - valkey_data:/data
    networks:
      - broker_net

volumes:
  valkey_data:

networks:
  broker_net:
    driver: overlay

configs:
  broker_config:
    file: ./config.yaml
```

### Docker Compose

```bash
docker compose up -d
```

See `compose.yaml.example` for a local compose setup with read-only config mount.

### Docker healthcheck

The Docker image includes a `HEALTHCHECK` that runs:

```bash
node dist/healthcheck.js
```

The healthcheck connects to the broker via MQTT over WebSocket, authenticates as the runtime-created healthcheck user `docker_health`, subscribes to `healthcheck/docker_health`, publishes a unique loopback payload to the same topic, and returns exit code 0 only after it receives that exact payload back through the subscription. It also validates Valkey readiness for the current broker instance, so Docker Swarm does not mark the container healthy until the broker has registered itself in Valkey.

On every broker start, a new random 32-character password is generated for `docker_health`. The broker writes the credentials to a local runtime file with mode `0600`, and the Docker healthcheck reads the file at the fixed internal path `/tmp/meshcore-mqtt-broker/docker_health_credentials.json` when it runs. This path is not configurable. The generated `docker_health` password should not be added to `subscribers.users`; the broker adds the user in memory on every start. The default URL is `ws://127.0.0.1:${mqtt.ws_port}` and can be changed with `healthcheck.mqtt_url`. The healthcheck sends MQTT PINGREQ packets while waiting so the broker does not close the temporary healthcheck client during slow or delayed checks.

Valkey readiness uses `broker.kv_url`, `broker.kv_namespace`, and the generated broker runtime ID. `healthcheck.valkey_timeout_ms` controls the Valkey connection timeout and `healthcheck.valkey_ready_max_age_ms` controls how fresh the instance readiness key must be.

This project can also be deployed via Nixpacks (e.g., to Dokploy). Configure the app root/build path as the repository root.

For setting up with TLS using Cloudflare Tunnels, see [docs/cloudflare-tunnels.md](docs/cloudflare-tunnels.md). This is the recommended way to deploy the MQTT broker.

## GitHub Actions

The workflow runs broker tests, builds the broker image, and publishes with `needs: build`.

Pull requests run all required checks. Pushes to `main` build and publish images. Publish jobs push `latest` and `sha-<short-sha>` tags to Docker Hub and GitHub Packages.

Configure these repository settings before enabling publish:

- Repository variable `DOCKERHUB_USERNAME`
- Repository secret `DOCKERHUB_TOKEN`

GitHub Packages publishing uses the workflow `GITHUB_TOKEN` with `packages: write`.

## Dependency Updates

Dependency updates are handled by Renovate. The repository includes
`.github/workflows/renovate.yml`, which runs Renovate on a GitHub-hosted runner
every six hours and can also be started manually with `workflow_dispatch`.

Before enabling the workflow, add a `RENOVATE_TOKEN` repository secret from a
dedicated fine-grained PAT or GitHub App installation token with access to open
dependency PRs in this repository. Do not use the workflow `GITHUB_TOKEN` for
Renovate PR creation, because GitHub suppresses most follow-up workflow runs
from changes made with that token.

To complete the migration away from Dependabot, disable Dependabot version
updates in repository settings once Renovate is enabled.

## License

MIT. See [LICENSE.md](LICENSE.md).
