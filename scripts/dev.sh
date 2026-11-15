#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

project="${PARFOCAL_DEV_PROJECT:-parfocal}"
identity="${PARFOCAL_DEV_IDENTITY:-local}"
export PARFOCAL_ZITADEL_PROJECT="${PARFOCAL_ZITADEL_PROJECT:-$project-zitadel}"
export PARFOCAL_PG_PORT="${PARFOCAL_PG_PORT:-5432}"
export PARFOCAL_POOLER_PORT="${PARFOCAL_POOLER_PORT:-6432}"
export PARFOCAL_STORAGE_PORT="${PARFOCAL_STORAGE_PORT:-9000}"
export PARFOCAL_WEB_PORT="${PARFOCAL_WEB_PORT:-5173}"
export PARFOCAL_API_PORT="${PARFOCAL_API_PORT:-8000}"

step() {
  printf '\n== %s (%ss)\n' "$1" "$SECONDS"
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "make dev needs $1. $2" >&2
    exit 1
  fi
}

need node "Install Node 26."
need pnpm "Run corepack enable, or install pnpm 12."
need uv "Install uv from https://docs.astral.sh/uv/."
need docker "Install Docker Desktop or OrbStack."
need python3 "Install Python 3."
need curl "Install curl."
if [ "$identity" = local ]; then
  need tofu "Install OpenTofu (brew install opentofu)."
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is installed but not running. Start it and run make dev again." >&2
  exit 1
fi

step "Installing JavaScript packages"
pnpm install --frozen-lockfile

step "Installing Python packages"
uv sync --all-packages --frozen

step "Writing .env"
python3 scripts/dev_env.py "$root"

step "Starting Postgres, PgBouncer and MinIO"
docker compose -p "$project" up --detach --wait

if [ "$identity" = local ]; then
  step "Starting the local Zitadel"
  bash infra/local/zitadel-up.sh
fi

set -a
. ./.env
if [ "$identity" = local ]; then
  . ./.zitadel/e2e.env
fi
set +a

if [ -z "${ZITADEL_CLIENT_ID:-}" ]; then
  echo "ZITADEL_CLIENT_ID is empty. Fill the Zitadel Cloud settings in .env or use the local Zitadel." >&2
  exit 1
fi

export APP_ENV=dev
export PARFOCAL_PUBLIC_APP_ENV=dev
export DATABASE_URL="postgresql://parfocal_app@localhost:$PARFOCAL_POOLER_PORT/parfocal"
export MIGRATION_DATABASE_URL="postgresql://parfocal@localhost:$PARFOCAL_PG_PORT/parfocal"
export STORAGE_ENDPOINT="http://127.0.0.1:$PARFOCAL_STORAGE_PORT"
export PUBLIC_ORIGIN="http://localhost:$PARFOCAL_WEB_PORT"
export EMAIL_BACKEND="${EMAIL_BACKEND:-file}"

step "Migrating the database"
uv run --frozen --package parfocal-api alembic -c apps/api/alembic.ini upgrade head

step "Creating the local bucket"
uv run --frozen --package parfocal-api python -m parfocal_common.local_bucket

step "Seeding the ČVUT workspaces"
DATABASE_URL="$MIGRATION_DATABASE_URL" SEED_OWNER_EMAIL="${SEED_OWNER_EMAIL:-${ZITADEL_TEST_USERNAME:-}}" \
  uv run --frozen --package parfocal-api python -m parfocal_api.showcase

step "Starting the API and the web app"
uv run --frozen --package parfocal-api uvicorn parfocal_api.app:create_app --factory --port "$PARFOCAL_API_PORT" &
api=$!
pnpm --filter @parfocal/web dev --port "$PARFOCAL_WEB_PORT" --strictPort &
web=$!
trap 'kill "$api" "$web" 2>/dev/null || true' EXIT INT TERM

curl -fsS --retry 120 --retry-delay 1 --retry-connrefused -o /dev/null "http://localhost:$PARFOCAL_API_PORT/api/health"
curl -fsS --retry 120 --retry-delay 1 --retry-connrefused -o /dev/null "$PUBLIC_ORIGIN/"

step "Ready"
echo "Open $PUBLIC_ORIGIN and sign in."
if [ "$identity" = local ]; then
  echo "The user is $ZITADEL_TEST_USERNAME and the password is in .zitadel/test-password."
  echo "Zitadel runs at $ZITADEL_ISSUER and its mail at $MAILPIT_URL."
fi
echo "Press Ctrl-C to stop the API and the web app. The containers keep running."

wait "$api" "$web"
