# meshcore-mqtt-broker-bridge

MQTT bridge that subscribes to a source broker and republishes matching messages to a target broker.

Docker image: `bjorkan/meshcore-mqtt-broker-bridge`

## Configuration

Copy `.env.example` to `.env` and set the source and target broker credentials:

```bash
cp .env.example .env
```

The source credentials must match a subscriber user configured on the broker. The root `compose.yaml` example pairs this bridge with the `uplink` subscriber in `../broker/.env.example`.

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
