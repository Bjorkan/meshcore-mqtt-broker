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
SUBSCRIBER_4=uplink:change-this-password:2:1
# Docker healthcheck
# The broker automatically creates the docker_health runtime user on every start
# and generates a new 32-character password.
HEALTHCHECK_MQTT_TIMEOUT_MS=10000
# HEALTHCHECK_MQTT_KEEPALIVE_SECONDS=60
```

**Subscribe-only users** can read messages but cannot publish. They're useful for monitoring, debugging, and administrative dashboards.

The `uplink` subscriber is included for the bridge example in the repository root `compose.yaml`. If you change that user or password, update `../bridge/.env` to match.

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
BROKER_INSTANCE_ID=${HOSTNAME}
```

The broker uses Valkey for Aedes MQTT cluster routing/persistence, subscriber `maxConnections` counting, and runtime abuse/trust state across broker replicas. This lets publishers and subscribers land on different containers while still sharing MQTT delivery and policy state. The same path is used for one replica and ten replicas.

The intentional fork MQTT contract is unchanged in orchestration mode: client retained publishes are still stripped, publisher topic and payload validation stays the same, and non-admin subscriber restrictions still apply.

Runtime abuse decisions use Valkey-locked trust state so rate, duplicate, mute, and shadow-mode state is shared across replicas. There is no local abuse database.

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
    image: valkey/valkey:8-alpine
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

The healthcheck connects to the broker via MQTT over WebSocket, authenticates as the runtime-created healthcheck user `docker_health`, subscribes to `healthcheck/docker_health`, publishes a unique loopback payload to the same topic, and returns exit code 0 only after it receives that exact payload back through the subscription.

On every broker start, a new random 32-character password is generated for `docker_health`. The broker writes the credentials to a local runtime file with mode `0600`, and the Docker healthcheck reads the same file when it runs:

```bash
/tmp/meshcore-mqtt-broker/docker_health_credentials.json
```

The file can be moved with `HEALTHCHECK_MQTT_CREDENTIALS_FILE` when needed. The password should not be put in `.env`, and `docker_health` should not be added as `SUBSCRIBER_N`; the broker adds the user in memory on every start. The default URL is `ws://127.0.0.1:${MQTT_WS_PORT:-8883}` and can be changed with `HEALTHCHECK_MQTT_URL`. The healthcheck sends MQTT PINGREQ packets while waiting so the broker does not close the temporary healthcheck client during slow or delayed checks.

This project can also be deployed via Nixpacks (e.g., to Dokploy). Configure the app root/build path as `broker/`.

The build process will:
1. Install dependencies
2. Compile TypeScript to JavaScript
3. Run the compiled server

For setting up with TLS using Cloudflare Tunnels, see [docs/cloudflare-tunnels.md](docs/cloudflare-tunnels.md). This is the recommended way to deploy the MQTT broker.


## License

MIT. See [../LICENSE.md](../LICENSE.md).
