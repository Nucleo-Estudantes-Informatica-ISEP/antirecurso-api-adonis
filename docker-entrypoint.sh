#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  node ace.js migration:run --force
fi

exec "$@"
