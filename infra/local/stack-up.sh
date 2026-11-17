#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-parfocal}"
export PARFOCAL_ZITADEL_PROJECT="${PARFOCAL_ZITADEL_PROJECT:-$COMPOSE_PROJECT_NAME-zitadel}"
export PARFOCAL_WEB_PORT="${PARFOCAL_E2E_PORT:-${PARFOCAL_WEB_PORT:-5173}}"
if [ -n "${PARFOCAL_E2E_PORT:-}" ]; then
  export PARFOCAL_API_PORT="${PARFOCAL_E2E_API_PORT:-$((PARFOCAL_E2E_PORT + 2000))}"
else
  export PARFOCAL_API_PORT="${PARFOCAL_E2E_API_PORT:-${PARFOCAL_API_PORT:-8000}}"
fi
export PARFOCAL_PG_PORT="${PARFOCAL_PG_PORT:-5432}"
export PARFOCAL_POOLER_PORT="${PARFOCAL_POOLER_PORT:-6432}"
export PARFOCAL_STORAGE_PORT="${PARFOCAL_STORAGE_PORT:-9000}"
export PARFOCAL_ZITADEL_PORT="${PARFOCAL_ZITADEL_PORT:-8089}"

bash infra/local/zitadel-up.sh

mkdir -p .outbox
chmod 0777 .outbox

docker compose -f compose.yaml -f infra/local/stack.compose.yaml up \
  --detach --wait --wait-timeout 300 --build

export APP_ENV=test
export STORAGE_ENDPOINT="http://127.0.0.1:$PARFOCAL_STORAGE_PORT"
export DATABASE_URL="postgresql://parfocal@localhost:$PARFOCAL_PG_PORT/parfocal"
SEED_OWNER_EMAIL="$(grep '^ZITADEL_TEST_USERNAME=' .zitadel/e2e.env | cut -d= -f2-)"
export SEED_OWNER_EMAIL

uv run --frozen --package parfocal-api python scripts/stack_fixtures.py
uv run --frozen --package parfocal-api python -m parfocal_api.showcase

echo "The stack is up. The API container answers on http://localhost:$PARFOCAL_API_PORT."
echo "Run the end-to-end suite with pnpm test:e2e and stop the stack with pnpm stack:down."
