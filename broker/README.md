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

# Authentication Settings
# Expected audience claim in JWT tokens (leave empty to skip validation)
AUTH_EXPECTED_AUDIENCE=mqtt.yourdomain.com

# Subscribe-Only Users (read-only monitoring accounts)
# Format: SUBSCRIBER_N=username:password:role:maxConnections
# Role: 1=admin (full access + delete + PII), 2=full_access (no filtering), 3=limited (filtered)
# maxConnections: number for override, D or omit to use default
# Add as many as you need by incrementing the number
SUBSCRIBER_MAX_CONNECTIONS_DEFAULT=2
SUBSCRIBER_1=admin:your-secure-password-here:1:10
SUBSCRIBER_2=viewer:another-secure-password:2
SUBSCRIBER_3=monitor:yet-another-password:3:D
SUBSCRIBER_4=uplink:change-this-password:2:1
```

**Subscribe-only users** can read messages but cannot publish. They're useful for monitoring, debugging, and administrative dashboards.

The `uplink` subscriber is included for the bridge example in the repository root `compose.yaml`. If you change that user or password, update `../bridge/.env` to match.

**Subscriber Roles**:
- **Role 1 (Admin)**: Full access including `/internal` topics (contains PII), `$SYS/*` system topics, and ability to delete retained messages
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
- `{subtopic}` must be one of `status`, `packets`, `raw`, or the broker extension `serial/responses`

The broker accepts MQTT retained publishes from clients for MeshCore observer compatibility, but always strips `retain` before processing. Clients cannot create retained MQTT state.

**Important**: The `/internal` subtopic is broker-owned, ADMIN-only, and contains PII (Personally Identifiable Information) from JWT payloads. Publishers cannot write `/internal`; the broker publishes it itself. `/serial/commands` is admin-only and may only be written by role 1 subscribers.

All published `packets`, `raw`, and `status` messages must be valid JSON and contain an `origin_id` field matching your authenticated public key. `packets` and `raw` must include an even-length hex `raw` field that is no larger than `ABUSE_MAX_PACKET_SIZE`. JSON publishes are rejected before parsing if they exceed `MQTT_JSON_PUBLISH_MAX_BYTES`. `serial/responses` is an opaque JWT-shaped payload, but it is still checked for maximum size and abuse/rate policy.

Abuse detection runs for publisher JSON messages and `serial/responses`. With `ABUSE_ENFORCEMENT_ENABLED=false`, clients that would be muted are marked as `would_mute` in `/internal` trust state while their traffic is still allowed. With `ABUSE_ENFORCEMENT_ENABLED=true`, muted publishers are rejected by the broker.

Abuse blocks are time-limited. The first enforced abuse block lasts 1 hour. The second and all later enforced abuse blocks for the same public key last 6 hours. When the block expires, the broker automatically allows the publisher again and refills its token bucket. The `/internal` trust state includes `mutedAt`, `mutedUntil`, `muteReason`, and `abuseBlockCount`.

Publishers are publish-only except that they may subscribe to their own `meshcore/{IATA_CODE}/{PUBLIC_KEY}/serial/commands` topic. Role 2 subscribers can subscribe to `meshcore/#`, but broker-owned `/internal`, `/serial/*`, and `$SYS/*` messages are not forwarded to non-admin subscribers.


## Deployment

Use this directory as the Docker build context or application root.

```bash
docker build -t bjorkan/meshcore-mqtt-broker .
```

This project can also be deployed via Nixpacks (e.g., to Dokploy). Configure the app root/build path as `broker/`.

The build process will:
1. Install dependencies
2. Compile TypeScript to JavaScript
3. Run the compiled server

For setting up with TLS using Cloudflare Tunnels, see [docs/cloudflare-tunnels.md](docs/cloudflare-tunnels.md). This is the recommended way to deploy the MQTT broker.


## License

MIT. See [../LICENSE.md](../LICENSE.md).
