# meshcore-mqtt-broker-bridge

MQTT bridge that subscribes to a source broker and republishes matching messages to a target broker.

Docker image: `bjorkan/meshcore-mqtt-broker-bridge`

## Configuration

Copy `.env.example` to `.env` and set the source and target broker settings:

```bash
cp .env.example .env
```

The source account must match a subscriber user configured on the broker. The root `compose.yaml` example pairs this bridge with the `uplink` subscriber in `../broker/.env.example`.

The default source broker URL is `ws://meshcore-mqtt-broker:8883`, matching the Docker Swarm service name used by the root compose example.

Heartbeat publishing is enabled by default and can be configured with `HEARTBEAT_ENABLED`, `HEARTBEAT_TOPIC`, `HEARTBEAT_MESSAGE`, and `HEARTBEAT_INTERVAL_MS`.

## Delivery semantics

The bridge is best-effort forwarding, not guaranteed delivery. It subscribes to the source broker and republishes matching messages to the target broker with QoS 0. If the target broker is disconnected or not ready, source messages are dropped instead of queued in memory or on disk.

Dropped messages are logged with a counter for the current process lifetime. If you need guaranteed delivery, run a broker/bridge setup with a queueing layer or add an explicit bounded queue with a documented retry and drop policy.

## Usage

```bash
npm install
npm start
```

## Docker

Use this directory as the Docker build context:

```bash
docker build -t bjorkan/meshcore-mqtt-broker-bridge .
```
