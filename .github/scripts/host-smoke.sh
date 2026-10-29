#!/usr/bin/env bash
set -euo pipefail

target/release/meshcore-mqtt-broker >/tmp/mc-mqtt-smoke-server.log 2>&1 &
broker_pid=$!
trap 'kill "${broker_pid}" 2>/dev/null || true' EXIT

for attempt in $(seq 1 20); do
  if curl --fail --silent --max-time 1 http://127.0.0.1:8883/status \
    | grep -q '"storage":"stateless"'; then
    echo "smoke: Rust HTTP status endpoint ok"
    break
  fi
  if ! kill -0 "${broker_pid}" 2>/dev/null; then
    cat /tmp/mc-mqtt-smoke-server.log
    exit 1
  fi
  if [ "${attempt}" = 20 ]; then
    cat /tmp/mc-mqtt-smoke-server.log
    exit 1
  fi
  sleep 1
done

target/release/meshcore-mqtt-broker healthcheck

for attempt in $(seq 1 20); do
  rm -f /tmp/mc-mqtt-smoke-headers
  curl_exit=0
  curl --silent --http1.1 --max-time 1 \
    --dump-header /tmp/mc-mqtt-smoke-headers \
    --output /dev/null \
    --header 'Connection: Upgrade' \
    --header 'Upgrade: websocket' \
    --header 'Sec-WebSocket-Version: 13' \
    --header 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    --header 'Sec-WebSocket-Protocol: mqtt' \
    http://127.0.0.1:8883/ || curl_exit=$?

  if grep -q '101 Switching Protocols' /tmp/mc-mqtt-smoke-headers \
    && grep -qi '^sec-websocket-protocol: mqtt' /tmp/mc-mqtt-smoke-headers; then
    echo "smoke: Rust MQTT-over-WebSocket listener ok"
    break
  fi
  if ! kill -0 "${broker_pid}" 2>/dev/null; then
    cat /tmp/mc-mqtt-smoke-server.log
    exit 1
  fi
  if [ "${attempt}" = 20 ]; then
    echo "curl exit: ${curl_exit}"
    cat /tmp/mc-mqtt-smoke-headers || true
    cat /tmp/mc-mqtt-smoke-server.log
    exit 1
  fi
  sleep 1
done

kill -TERM "${broker_pid}"
for attempt in $(seq 1 10); do
  if ! kill -0 "${broker_pid}" 2>/dev/null; then
    wait "${broker_pid}"
    trap - EXIT
    echo "smoke: SIGTERM shutdown ok"
    exit 0
  fi
  if [ "${attempt}" = 10 ]; then
    cat /tmp/mc-mqtt-smoke-server.log
    exit 1
  fi
  sleep 1
done
