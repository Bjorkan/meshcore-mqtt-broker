# meshcore-mqtt-broker

This repository contains two separate Docker image projects:

- `broker/` builds `bjorkan/meshcore-mqtt-broker`
- `bridge/` builds `bjorkan/meshcore-mqtt-broker-bridge`

The root `compose.yaml` is a barebone example that runs the published images together.

## Compose Example

```bash
cp broker/.env.example broker/.env
cp bridge/.env.example bridge/.env
docker compose up -d
```

The bridge source credentials must match a subscriber account configured for the broker. The example env files include a matching `uplink` subscriber.

## Local Builds

```bash
docker build -t bjorkan/meshcore-mqtt-broker ./broker
docker build -t bjorkan/meshcore-mqtt-broker-bridge ./bridge
```

## GitHub Actions

The workflows are split per image and stage:

- `Check tests for Broker`: runs on broker pushes and pull requests
- `Check tests for Bridge`: runs on bridge pushes and pull requests
- `Build image for Broker`: builds the broker image on broker pushes and pull requests
- `Build image for Bridge`: builds the bridge image on bridge pushes and pull requests
- `Publish image broker`: loads the broker image artifact and publishes only after `Build image for Broker` succeeds from a push to `main`
- `Publish image bridge`: loads the bridge image artifact and publishes only after `Build image for Bridge` succeeds from a push to `main`

Configure these repository settings before enabling publish:

- Repository variable `DOCKERHUB_USERNAME`
- Repository secret `DOCKERHUB_TOKEN`

See `broker/README.md` and `bridge/README.md` for image-specific configuration.
