#!/bin/sh
set -eu

if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
  alembic -c /app/alembic.ini upgrade head
fi

exec uvicorn parfocal_api.app:create_app --factory --host 0.0.0.0 --port "${PORT}" "$@"
