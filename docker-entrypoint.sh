#!/bin/sh
set -eu

DATA_DIR=/data/meshcore-mqtt-broker

if [ ! -e "$DATA_DIR" ]; then
  mkdir -p -m 0750 "$DATA_DIR"
fi

if [ ! -d "$DATA_DIR" ]; then
  echo "KRITISKT: $DATA_DIR är inte en katalog." >&2
  exit 1
fi

if [ "$(id -u)" = "0" ]; then
  if ! chown bun:bun "$DATA_DIR" || ! chmod u+rwx "$DATA_DIR"; then
    echo "KRITISKT: $DATA_DIR kan inte förberedas för användaren bun. Kontrollera bind-monteringen och dess rättigheter." >&2
    exit 1
  fi
  if ! su bun -s /bin/sh -c 'test -r /data/meshcore-mqtt-broker && test -w /data/meshcore-mqtt-broker'; then
    echo "KRITISKT: användaren bun kan inte läsa och skriva $DATA_DIR." >&2
    exit 1
  fi
  exec setpriv --reuid=bun --regid=bun --init-groups "$@"
fi

if [ ! -r "$DATA_DIR" ] || [ ! -w "$DATA_DIR" ]; then
  echo "KRITISKT: containeranvändaren kan inte läsa och skriva $DATA_DIR." >&2
  exit 1
fi

exec "$@"
