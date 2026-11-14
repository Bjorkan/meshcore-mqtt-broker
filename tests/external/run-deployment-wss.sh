#!/usr/bin/env bash
set -euo pipefail

# Use the deployed image and Traefik with isolated synthetic broker state.
# Required: image ID, public hostname, and Docker network shared with Traefik.
image="${1:?usage: run-deployment-wss.sh IMAGE HOSTNAME NETWORK}"
hostname="${2:?public hostname required}"
network="${3:?Traefik Docker network required}"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/meshcore-wss.XXXXXX")"
container="meshcore-issue273-wss-${work##*.}"
route="/$container"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

client="${MESHCORE_PAHO_CLIENT:-$work/paho}"
if [[ -z "${MESHCORE_PAHO_CLIENT:-}" ]]; then
  (cd "$root/tests/external/beacon-paho" && go build -o "$client" .)
fi
cat >"$work/config.yaml" <<'YAML'
mqtt:
  host: 0.0.0.0
  ws_port: 8883
broker:
  name: isolated-deployment-test
auth:
  expected_audience: integration
subscribers:
  default_max_connections: 2
  users:
    - username: full
      password: secret
      role: 2
      max_connections: 2
iata:
  allowlist_enabled: true
allowed_iata: [STO]
target_mqtt:
  url: ""
meshcore_io:
  enabled: false
  api_url: ""
YAML

docker run --detach --name "$container" --network "$network" \
  --mount "type=bind,src=$work/config.yaml,dst=/run/configs/meshcore-mqtt-broker-config.yaml,readonly" \
  --label traefik.enable=true \
  --label "traefik.docker.network=$network" \
  --label "traefik.http.routers.$container.rule=Host(\`$hostname\`) && PathPrefix(\`$route/\`)" \
  --label "traefik.http.routers.$container.entrypoints=websecure" \
  --label "traefik.http.routers.$container.tls=true" \
  --label "traefik.http.routers.$container.priority=10000" \
  --label "traefik.http.routers.$container.middlewares=$container" \
  --label "traefik.http.middlewares.$container.stripprefix.prefixes=$route" \
  --label "traefik.http.services.$container.loadbalancer.server.port=8883" \
  "$image" >/dev/null

ready=false
for _ in {1..100}; do
  if docker exec "$container" /usr/local/bin/meshcore-mqtt-broker healthcheck >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 0.1
done
if [[ "$ready" != true ]]; then
  echo 'isolated broker did not become healthy' >&2
  exit 1
fi
# Verify the public route reaches the synthetic broker before authenticating.
ready=false
for _ in {1..100}; do
  if curl --fail --silent "https://$hostname$route/status" | python3 -c 'import json,sys; assert json.load(sys.stdin)["instanceId"].startswith("isolated-deployment-test-")' 2>/dev/null; then
    ready=true
    break
  fi
  sleep 0.2
done
if [[ "$ready" != true ]]; then
  echo 'Traefik did not route to the isolated broker' >&2
  exit 1
fi
"$client" -url "wss://$hostname$route/mqtt"
echo 'isolated deployed-image WSS via production Traefik: passed'
