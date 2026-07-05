#!/bin/sh
set -eu

if [ "$(id -u)" = "0" ]; then
  exec su node -s /bin/sh -c 'exec "$@"' -- sh "$@"
fi

exec "$@"
