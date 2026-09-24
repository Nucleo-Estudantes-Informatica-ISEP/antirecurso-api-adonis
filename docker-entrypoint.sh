#!/bin/sh
set -eu

if [ "${RUN_MIGRATIONS:-false}" = "true" ]; then
  DB_URL="${DB_MIGRATION_URL:?Configure restricted migrator URL}" node ace.js migration:run --force
fi

exec "$@"
