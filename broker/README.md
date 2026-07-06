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
    aud: 'mqtt.yourdomain.com', // Must match AUTH_EXPECTED_AUDIENCE in .env
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

All configuration is done via environment variables in a `.env` file.

From this directory, copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# MQTT Server Settings
MQTT_WS_PORT=8883
MQTT_HOST=0.0.0.0
MQTT_WS_MAX_PAYLOAD_BYTES=65536
MQTT_JSON_PUBLISH_MAX_BYTES=8192

# Optional target broker forwarding
# Empty TARGET_MQTT_URL disables forwarding.
TARGET_MQTT_URL=
TARGET_MQTT_USERNAME=
TARGET_MQTT_PASSWORD=

# Authentication Settings
# Expected audience claim in JWT tokens (leave empty to skip validation)
AUTH_EXPECTED_AUDIENCE=mqtt.yourdomain.com

# Subscribe-Only Users (read-only monitoring accounts)
# Format: SUBSCRIBER_N=username:password:role:maxConnections
# Role: 1=admin (full access + PII), 2=full_access (no filtering), 3=limited (filtered)
# maxConnections: number for override, D or omit to use default
# Add as many as you need by incrementing the number
SUBSCRIBER_MAX_CONNECTIONS_DEFAULT=2
SUBSCRIBER_1=admin:your-secure-password-here:1:10
SUBSCRIBER_2=viewer:another-secure-password:2
SUBSCRIBER_3=monitor:yet-another-password:3:D
# Docker healthcheck
# The broker automatically creates the docker_health runtime user on every start
# and generates a new 32-character password.
HEALTHCHECK_MQTT_TIMEOUT_MS=10000
# HEALTHCHECK_MQTT_KEEPALIVE_SECONDS=60
```

**Subscribe-only users** can read messages but cannot publish. They're useful for monitoring, debugging, and administrative dashboards.

The broker-integrated target forwarding does not require a local subscriber account. Only configure an `uplink` subscriber if you still run the legacy standalone `bridge/` service.

Numeric configuration is validated at startup. Ports must be in the range `1..65535`; payload sizes, time windows, counters, and connection limits must be positive integers unless the `.env.example` notes otherwise. Invalid numeric values stop the broker before it starts listening.

`MQTT_WS_MAX_PAYLOAD_BYTES` is the early WebSocket/MQTT transport frame limit. Frames above this are closed before they are passed into Aedes. `MQTT_JSON_PUBLISH_MAX_BYTES` is the later application limit for normal JSON publish payloads. `ABUSE_MAX_PACKET_SIZE` is used by abuse detection for raw LoRa packet data when a JSON message includes a `raw` field.

**Subscriber Roles**:
- **Role 1 (Admin)**: Full access including `/internal` topics (contains PII), `$SYS/*` system topics, and admin-only `/serial/commands` publishing
- **Role 2 (Full Access)**: Access to all public topics with no data filtering, cannot access `/internal` or `$SYS/*`
- **Role 3 (Limited)**: Access to public topics only with sensitive data filtered (SNR, RSSI, score, stats, model, firmware_version removed from messages)

## Installation

```bash
# From the repository root:
cd broker
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
      aud: 'mqtt.yourdomain.com', // Must match AUTH_EXPECTED_AUDIENCE in .env
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
- `{IATA_CODE}` must be a 3-letter region code listed in `allowed_regions.yaml`, or in the optional `ALLOWED_REGIONS` env extension, or `test` for testing
- `{PUBLIC_KEY}` must be the full 64-character hex public key (matching your authenticated public key)
- `{subtopic}` can be any upstream-compatible observer subtopic, except documented broker-owned/reserved paths such as `/internal` and unsupported `/serial/*` topics. The broker extension `serial/responses` is allowed.

The broker accepts MQTT retained publishes from clients for MeshCore observer compatibility, but always strips `retain` before processing. Clients cannot create retained MQTT state.

**Important**: The `/internal` subtopic is broker-owned, ADMIN-only, and contains PII (Personally Identifiable Information) from JWT payloads. Publishers cannot write `/internal`; the broker publishes it itself as non-retained live telemetry (no retained internal state). `/serial/commands` is admin-only and may only be written by role 1 subscribers.

All normal JSON publishes must be valid JSON and contain an `origin_id` field matching your authenticated public key. A `raw` field is accepted and used by abuse detection when present, but it is not required by default for upstream-compatible observer traffic. JSON publishes are rejected before parsing if they exceed `MQTT_JSON_PUBLISH_MAX_BYTES`. `serial/responses` is an opaque JWT-shaped payload, but it is still checked for maximum size and abuse/rate policy.

Abuse detection runs for publisher JSON messages and `serial/responses`. With `ABUSE_ENFORCEMENT_ENABLED=false`, clients that would be muted are marked as `would_mute` in `/internal` trust state while their traffic is still allowed. With `ABUSE_ENFORCEMENT_ENABLED=true`, muted publishers are rejected by the broker.

Publishers may switch freely between allowed IATA/region codes such as `GSE` and `GOT` without being muted. `ABUSE_MAX_IATA_CHANGES_24H` is an observation threshold for logs and `/internal` trust state only; it does not reject otherwise valid publishes.

Abuse blocks are time-limited. The first enforced abuse block lasts 1 hour. The second and all later enforced abuse blocks for the same public key last 6 hours. When the block expires, the broker automatically allows the publisher again and refills its token bucket. The `/internal` trust state includes `mutedAt`, `mutedUntil`, `muteReason`, and `abuseBlockCount`.

Publishers are publish-only except that they may subscribe to their own exact `meshcore/{IATA_CODE}/{PUBLIC_KEY}/serial/commands` topic in an allowed region. Non-admin subscribe-time restrictions are an intentional fork behavior: role 2 and role 3 subscribers may subscribe only to public MeshCore topics and documented broker topics such as `heartbeat/`; the runtime `docker_health` user is additionally allowed to publish and subscribe only to its internal `healthcheck/docker_health` loopback topic. Broker-owned `/internal`, `/serial/*`, and `$SYS/*` messages are also blocked by forward-time filtering for non-admin subscribers.

## Target broker forwarding

The broker can publish its locally claimed observer traffic to another MQTT broker without running the separate `bridge/` service. Set these variables in `broker/.env`:

```bash
TARGET_MQTT_URL=mqtts://mqtt.example.com:8883
TARGET_MQTT_USERNAME=
TARGET_MQTT_PASSWORD=
```

Forwarding is disabled when `TARGET_MQTT_URL` is empty. The target MQTT client ID follows the broker runtime ID, so each broker replica has a distinct target connection. A broker forwards only messages from publisher clients whose observer public key it has claimed in Valkey; other replicas are responsible for the observers they have claimed. Forwarded publishes keep the original `meshcore/{IATA}/{PUBLIC_KEY}/{subtopic}` topic and payload, but are always sent with `retain: false`.


## Deployment

Use this directory as the Docker build context or application root.

```bash
docker build -t bjorkan/meshcore-mqtt-broker .
```

### Docker Swarm orchestration with Valkey

The broker always runs in Valkey-backed orchestration mode. `BROKER_KV_URL` is required even when you run a single broker replica. Valkey uses the Redis protocol, so the URL normally starts with `redis://`.

```bash
BROKER_KV_URL=redis://valkey:6379
BROKER_KV_NAMESPACE=meshcore-mqtt-broker
BROKER_NAME=Broker
```

The broker uses Valkey for Aedes MQTT cluster routing/persistence, subscriber `maxConnections` counting, runtime abuse/trust state, and broker instance readiness across replicas. This lets publishers and subscribers land on different containers while still sharing MQTT delivery and policy state. The same path is used for one replica and ten replicas.

Each broker process generates a fresh runtime ID on startup, for example `Broker-42GH`. Set `BROKER_NAME` to change only the prefix before the dash, for example `Meshat-HD21`; the ID suffix is always chosen by the broker and cannot be supplied through `.env`. The generated ID is written to a local runtime file so `mc-mqtt`, the healthcheck, dashboard metrics, Valkey readiness, observer claims, and target bridge client ID all refer to the same runtime. If Valkey already has a fresh readiness key for the generated broker ID, startup fails and the container exits so Swarm/Kubernetes can start a replacement with a new generated ID.

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
    environment:
      BROKER_KV_URL: redis://valkey:6379
      BROKER_KV_NAMESPACE: meshcore-mqtt-broker
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
```


### Docker healthcheck

The Docker image includes a `HEALTHCHECK` that runs:

```bash
node dist/healthcheck.js
```

The healthcheck connects to the broker via MQTT over WebSocket, authenticates as the runtime-created healthcheck user `docker_health`, subscribes to `healthcheck/docker_health`, publishes a unique loopback payload to the same topic, and returns exit code 0 only after it receives that exact payload back through the subscription. It also validates Valkey readiness for the current broker instance, so Docker Swarm does not mark the container healthy until the broker has registered itself in Valkey.

On every broker start, a new random 32-character password is generated for `docker_health`. The broker writes the credentials to a local runtime file with mode `0600`, and the Docker healthcheck reads the same file when it runs:

```bash
/tmp/meshcore-mqtt-broker/docker_health_credentials.json
```

The file can be moved with `HEALTHCHECK_MQTT_CREDENTIALS_FILE` when needed. The password should not be put in `.env`, and `docker_health` should not be added as `SUBSCRIBER_N`; the broker adds the user in memory on every start. The default URL is `ws://127.0.0.1:${MQTT_WS_PORT:-8883}` and can be changed with `HEALTHCHECK_MQTT_URL`. The healthcheck sends MQTT PINGREQ packets while waiting so the broker does not close the temporary healthcheck client during slow or delayed checks.

Valkey readiness uses `BROKER_KV_URL`, `BROKER_KV_NAMESPACE`, and the generated broker runtime ID. `HEALTHCHECK_VALKEY_TIMEOUT_MS` controls the Valkey connection timeout and `HEALTHCHECK_VALKEY_READY_MAX_AGE_MS` controls how fresh the instance readiness key must be.

This project can also be deployed via Nixpacks (e.g., to Dokploy). Configure the app root/build path as `broker/`.

The build process will:
1. Install dependencies
2. Compile TypeScript to JavaScript
3. Run the compiled server

For setting up with TLS using Cloudflare Tunnels, see [docs/cloudflare-tunnels.md](docs/cloudflare-tunnels.md). This is the recommended way to deploy the MQTT broker.


## License

MIT. See [../LICENSE.md](../LICENSE.md).
