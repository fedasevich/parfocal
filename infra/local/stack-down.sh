#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-parfocal}"
export PARFOCAL_ZITADEL_PROJECT="${PARFOCAL_ZITADEL_PROJECT:-$COMPOSE_PROJECT_NAME-zitadel}"

docker compose -f compose.yaml -f infra/local/stack.compose.yaml down --remove-orphans
docker compose -p "$PARFOCAL_ZITADEL_PROJECT" -f infra/local/zitadel.compose.yaml down --remove-orphans
