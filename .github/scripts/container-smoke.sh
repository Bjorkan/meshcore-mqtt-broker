#!/usr/bin/env bash
set -euo pipefail

image=${1:?usage: container-smoke.sh IMAGE [PLATFORM]}
platform=${2:-linux/amd64}
container="meshcore-mqtt-smoke-${RANDOM}-${RANDOM}"

cleanup() {
  docker rm --force "${container}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach \
  --name "${container}" \
  --platform "${platform}" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --health-start-period 0s \
  --health-interval 1s \
  --health-timeout 2s \
  --health-retries 10 \
  --publish 127.0.0.1::8883 \
  --volume "${GITHUB_WORKSPACE}/config.yaml:/run/configs/meshcore-mqtt-broker-config.yaml:ro" \
  "${image}" >/dev/null

for attempt in $(seq 1 30); do
  state=$(docker inspect --format '{{.State.Status}}' "${container}")
  health=$(docker inspect --format '{{.State.Health.Status}}' "${container}")
  if [ "${state}" != "running" ]; then
    docker logs "${container}"
    exit 1
  fi
  if [ "${health}" = "healthy" ]; then
    break
  fi
  if [ "${attempt}" = 30 ]; then
    docker inspect "${container}"
    docker logs "${container}"
    exit 1
  fi
  sleep 1
done

uid=$(docker exec "${container}" sh -c 'grep "^Uid:" /proc/1/status' | awk '{print $2}')
test "${uid}" != 0
docker exec "${container}" meshcore-mqtt-broker healthcheck

host_port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "8883/tcp") 0).HostPort}}' "${container}")
curl --fail --silent --max-time 2 "http://127.0.0.1:${host_port}/status" \
  | grep -q '"storage":"stateless"'

headers=$(mktemp)
curl_exit=0
curl --silent --http1.1 --max-time 2 \
  --dump-header "${headers}" \
  --output /dev/null \
  --header 'Connection: Upgrade' \
  --header 'Upgrade: websocket' \
  --header 'Sec-WebSocket-Version: 13' \
  --header 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  --header 'Sec-WebSocket-Protocol: mqtt' \
  "http://127.0.0.1:${host_port}/" || curl_exit=$?
grep -q '101 Switching Protocols' "${headers}"
grep -qi '^sec-websocket-protocol: mqtt' "${headers}"
test "${curl_exit}" = 0 || test "${curl_exit}" = 28

docker kill --signal TERM "${container}" >/dev/null
exit_code=$(docker wait "${container}")
test "${exit_code}" = 0
