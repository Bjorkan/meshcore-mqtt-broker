#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
work="$(mktemp -d "${TMPDIR:-/tmp}/meshcore-paho.XXXXXX")"
broker_pid=""

cleanup() {
  if [[ -n "$broker_pid" ]]; then
    kill -TERM "$broker_pid" 2>/dev/null || true
    wait "$broker_pid" 2>/dev/null || true
  fi
  rm -rf "$work"
}
trap cleanup EXIT

cat >"$work/config.yaml" <<'YAML'
mqtt:
  host: 127.0.0.1
  ws_port: 18883
  trusted_proxies: []
  ws_max_payload_bytes: 65536
  json_publish_max_bytes: 8192
broker:
  name: external-paho-test
auth:
  expected_audience: integration
  token_max_age_seconds: 0
subscribers:
  default_max_connections: 2
  users:
    - username: full
      password: secret
      role: 2
      max_connections: 2
iata:
  allowlist_enabled: true
  allow_test_ingress: false
allowed_iata: [STO]
target_mqtt:
  url: ""
meshcore_io:
  enabled: false
  api_url: ""
healthcheck:
  http_timeout_ms: 1000
  http_url: http://127.0.0.1:18883/status
YAML

cargo build --locked --manifest-path "$root/Cargo.toml"
MESHCORE_CONFIG="$work/config.yaml" "$root/target/debug/meshcore-mqtt-broker" >"$work/broker.log" 2>&1 &
broker_pid=$!

ready=false
for _ in {1..100}; do
  if curl --fail --silent http://127.0.0.1:18883/status >/dev/null; then
    ready=true
    break
  fi
  if ! kill -0 "$broker_pid" 2>/dev/null; then
    cat "$work/broker.log" >&2
    exit 1
  fi
  sleep 0.1
done
if [[ "$ready" != true ]]; then
  cat "$work/broker.log" >&2
  echo "broker did not become ready" >&2
  exit 1
fi

cd "$root/tests/external/beacon-paho"
go run . -url ws://127.0.0.1:18883/mqtt
