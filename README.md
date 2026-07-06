# meshcore-mqtt-broker

This repository contains the broker Docker image project and a legacy standalone bridge:

- `broker/` builds `bjorkan/meshcore-mqtt-broker` and `ghcr.io/bjorkan/meshcore-mqtt-broker`
- `bridge/` builds the older standalone `bjorkan/meshcore-mqtt-broker-bridge` image

Target-broker forwarding now lives inside the broker. Set `TARGET_MQTT_URL`, `TARGET_MQTT_USERNAME`, and `TARGET_MQTT_PASSWORD` in `broker/.env`; the broker uses its generated runtime ID as the target MQTT client ID and only forwards traffic for observers it has claimed.

## Compose Example

```bash
cp broker/.env.example broker/.env
docker compose up -d
```

Set `TARGET_MQTT_URL` in `broker/.env` to enable broker-integrated forwarding. Leave it empty to run only the local broker.

## Local Builds

```bash
docker build -t bjorkan/meshcore-mqtt-broker ./broker
```

## GitHub Actions

The workflows are split per image:

- `Build image for Broker`: runs broker tests, builds the broker image with `needs: test`, and publishes with `needs: build`
- `Build image for Bridge`: runs bridge tests, builds the bridge image with `needs: test`, and publishes with `needs: build`

Pull requests run all required checks. Pushes to `main` only build and publish images for the image folder that changed. Publish jobs push `latest` and `sha-<short-sha>` tags to Docker Hub and GitHub Packages.

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

See `broker/README.md` and `bridge/README.md` for image-specific configuration.
