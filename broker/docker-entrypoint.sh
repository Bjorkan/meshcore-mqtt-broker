#!/bin/sh
set -eu

DATA_DIR="${ABUSE_DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec su node -s /bin/sh -c 'exec "$@"' -- sh "$@"
fi

exec "$@"
