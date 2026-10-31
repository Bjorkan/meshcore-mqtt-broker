#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/meshcore-target-tls.XXXXXX")"
image="meshcore-mqtt-broker:target-tls-test-$$"
server_pid=""
container="meshcore-target-tls-$$"

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
  if [[ -n "$server_pid" ]]; then
    kill -TERM "$server_pid" 2>/dev/null || true
    wait "$server_pid" 2>/dev/null || true
  fi
  docker image rm "$image" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
  -subj "/CN=MeshCore synthetic test CA" \
  -keyout "$work/ca.key" -out "$work/ca.crt" >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" \
  -keyout "$work/server.key" -out "$work/server.csr" >/dev/null 2>&1
cat >"$work/server.ext" <<'EOF'
subjectAltName=DNS:localhost
extendedKeyUsage=serverAuth
EOF
openssl x509 -req -days 1 -sha256 -in "$work/server.csr" \
  -CA "$work/ca.crt" -CAkey "$work/ca.key" -CAcreateserial \
  -extfile "$work/server.ext" -out "$work/server.crt" >/dev/null 2>&1

go run "$root/tests/external/target-tls/server.go" \
  -cert "$work/server.crt" -key "$work/server.key" >"$work/target.log" 2>&1 &
server_pid=$!

docker build --quiet --tag "$image" "$root" >/dev/null

write_config() {
  local target_url=$1
  cat >"$work/config.yaml" <<YAML
mqtt:
  host: 127.0.0.1
  ws_port: 28884
  trusted_proxies: []
  ws_max_payload_bytes: 65536
  json_publish_max_bytes: 8192
broker:
  name: target-tls-test
auth:
  expected_audience: integration
subscribers:
  default_max_connections: 2
  users: []
iata:
  allowlist_enabled: true
allowed_iata: [STO]
target_mqtt:
  url: "$target_url"
  reject_unauthorized: true
  reconnect_period_ms: 100
  connect_timeout_ms: 1000
meshcore_io:
  enabled: false
  api_url: ""
healthcheck:
  http_timeout_ms: 1000
  http_url: http://127.0.0.1:28884/status
YAML
}

start_container() {
  local mount_ca=$1
  local arguments=(
    run --detach --name "$container" --network host
    --mount "type=bind,src=$work/config.yaml,dst=/run/configs/meshcore-mqtt-broker-config.yaml,readonly"
  )
  if [[ "$mount_ca" == true ]]; then
    arguments+=(--mount "type=bind,src=$work/ca.crt,dst=/etc/ssl/certs/ca-certificates.crt,readonly")
  fi
  arguments+=("$image")
  docker "${arguments[@]}" >/dev/null
}

stop_container() {
  docker stop --time 10 "$container" >/dev/null
  docker rm "$container" >/dev/null
}

wait_for_status() {
  for _ in {1..100}; do
    if curl --fail --silent http://127.0.0.1:28884/status >"$work/status.json"; then
      return
    fi
    if ! docker inspect "$container" >/dev/null 2>&1; then
      docker logs "$container" >&2 || true
      exit 1
    fi
    sleep 0.1
  done
  docker logs "$container" >&2 || true
  echo "scratch container did not become ready" >&2
  exit 1
}

assert_target_state() {
  local expected=$1
  for _ in {1..100}; do
    curl --fail --silent http://127.0.0.1:28884/status >"$work/status.json"
    if grep --quiet "\"connected\":$expected" "$work/status.json"; then
      return
    fi
    sleep 0.1
  done
  cat "$work/status.json" >&2
  echo "target connected state did not become $expected" >&2
  exit 1
}

write_config mqtts://localhost:28883
start_container true
wait_for_status
assert_target_state true
stop_container

write_config mqtts://127.0.0.1:28883
start_container true
wait_for_status
sleep 1
assert_target_state false
stop_container

write_config mqtts://localhost:28883
start_container false
wait_for_status
sleep 1
assert_target_state false
stop_container

echo "scratch-image Target MQTT CA and hostname validation checks passed"
