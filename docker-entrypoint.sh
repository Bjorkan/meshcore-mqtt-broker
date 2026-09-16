#!/bin/sh
set -eu

# Stateless broker: the only mount is the read-only config file
# (./config.yaml:/run/configs/meshcore-mqtt-broker-config.yaml:ro).
# There is no /data volume and nothing is persisted. Just drop privileges
# when started as root, then exec the broker.

if [ "$(id -u)" = "0" ]; then
  exec setpriv --reuid=bun --regid=bun --init-groups "$@"
fi

exec "$@"
