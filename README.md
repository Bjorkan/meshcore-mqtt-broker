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

The workflows are split per image:

- `Build image for Broker`: runs broker tests, builds the broker image with `needs: test`, and publishes with `needs: build`
- `Build image for Bridge`: runs bridge tests, builds the bridge image with `needs: test`, and publishes with `needs: build`

Pull requests run all required checks. Pushes to `main` only build and publish images for the image folder that changed.

Configure these repository settings before enabling publish:

- Repository variable `DOCKERHUB_USERNAME`
- Repository secret `DOCKERHUB_TOKEN`

See `broker/README.md` and `bridge/README.md` for image-specific configuration.
