#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-t060}"
if [ "$COMPOSE_PROJECT_NAME" = "parfocal" ]; then
  echo "Use a compose project of your own, the parfocal project is shared" >&2
  exit 1
fi
export PARFOCAL_ZITADEL_PROJECT="$COMPOSE_PROJECT_NAME-zitadel"
export PARFOCAL_E2E_PORT="${PARFOCAL_E2E_PORT:-5194}"
export PARFOCAL_E2E_API_PORT="$((PARFOCAL_E2E_PORT + 2000))"
export PARFOCAL_WEB_PORT="$PARFOCAL_E2E_PORT"
export PARFOCAL_API_PORT="$PARFOCAL_E2E_API_PORT"
export PARFOCAL_PG_PORT="${PARFOCAL_PG_PORT:-5494}"
export PARFOCAL_POOLER_PORT="${PARFOCAL_POOLER_PORT:-6494}"
export PARFOCAL_STORAGE_PORT="${PARFOCAL_STORAGE_PORT:-9094}"
export PARFOCAL_ZITADEL_PORT="${PARFOCAL_ZITADEL_PORT:-8094}"
export PARFOCAL_MAILPIT_PORT="${PARFOCAL_MAILPIT_PORT:-8095}"
export TURBO_CONCURRENCY="${TURBO_CONCURRENCY:-2}"

out="${PARFOCAL_MAIN_PATH_OUT:-$root/.main-paths}"
slide="${PARFOCAL_MAIN_PATH_SLIDE_FILE:-$HOME/.cache/parfocal/fixtures/CMU-1.svs}"
persist="$out/wrangler-state"
tile_key="AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI="
stack=(docker compose -f compose.yaml -f infra/local/stack.compose.yaml)
mkdir -p "$out"

cat >"$out/limits.compose.yaml" <<'YAML'
services:
  server:
    environment:
      RATE_LIMIT_PERSON_PER_MINUTE: "100000"
      RATE_LIMIT_TENANT_PER_MINUTE: "100000"
YAML

cleanup() {
  "${stack[@]}" -f "$out/limits.compose.yaml" down --volumes --remove-orphans || true
  docker compose -p "$PARFOCAL_ZITADEL_PROJECT" -f infra/local/zitadel.compose.yaml \
    down --volumes --remove-orphans || true
  rm -rf "$persist" "$out/slide"
}
trap cleanup EXIT

conditions() {
  local pages
  pages="$(vm_stat | awk '/Pages (free|inactive|speculative)/ {gsub("\\.", "", $NF); sum += $NF} END {print sum}')"
  echo "$(date -u +%FT%TZ) available $((pages * 16384 / 1048576)) MiB, load $(sysctl -n vm.loadavg)"
}

PARFOCAL_PUBLIC_APP_ENV=test pnpm --filter @parfocal/web build >"$out/build.txt" 2>&1

bash infra/local/stack-up.sh
"${stack[@]}" -f "$out/limits.compose.yaml" up --detach --wait --wait-timeout 300 server
"${stack[@]}" -f "$out/limits.compose.yaml" up --detach --force-recreate --no-deps loopback

described="$(APP_ENV=test STORAGE_ENDPOINT="http://127.0.0.1:$PARFOCAL_STORAGE_PORT" \
  STORAGE_BUCKET=parfocal-local uv run --frozen --package parfocal-ingest \
  python scripts/main_path_slide_files.py "$slide" "$out/slide" --send-ranges)"
field() { python3 -c 'import json, sys; print(json.loads(sys.argv[1])[sys.argv[2]])' "$described" "$1"; }
key="$(field key)"
folder="$(dirname "$key")"
python3 -c 'import json, sys
for item in json.loads(sys.argv[1])["files"]:
    print(item["name"], item["content_type"], item["content_encoding"] or "")' "$described" |
  while read -r name type encoding; do
    pnpm --filter @parfocal/edge exec wrangler r2 object put "parfocal-dev-eu/$folder/$name" \
      --local --persist-to "$persist" --jurisdiction eu --file "$out/slide/$name" --ct "$type" \
      ${encoding:+--ce "$encoding"} >/dev/null
  done

conditions | tee -a "$out/conditions.txt"
PARFOCAL_EDGE_PERSIST="$persist" PARFOCAL_EDGE_TILE_KEY="$tile_key" \
  PARFOCAL_MAIN_PATH_SLIDE_KEY="$key" \
  PARFOCAL_MAIN_PATH_SLIDE_BYTES="$(field bytes)" \
  PARFOCAL_MAIN_PATH_SLIDE_FORMAT="$(field format)" \
  PARFOCAL_MAIN_PATH_SLIDE_SIZE="$(field size)" \
  PARFOCAL_MAIN_PATH_ROUNDS="${PARFOCAL_MAIN_PATH_ROUNDS:-8}" \
  pnpm --filter @parfocal/e2e exec playwright test -c playwright.production.config.ts --workers=1 \
  2>&1 | tee "$out/production.txt"
conditions | tee -a "$out/conditions.txt"
