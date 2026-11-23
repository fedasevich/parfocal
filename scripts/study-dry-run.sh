#!/usr/bin/env bash
set -euo pipefail

code="${1:?usage: scripts/study-dry-run.sh CODE, with PARFOCAL_SMOKE_EMAIL and PARFOCAL_SMOKE_PASSWORD of the seat account}"
: "${PARFOCAL_SMOKE_EMAIL:?the email of the seat account the participant signs in with}"
: "${PARFOCAL_SMOKE_PASSWORD:?the password of the seat account}"

root="$(cd "$(dirname "$0")/.." && pwd)"
report="$root/apps/web/test-results/study-dry-run.json"
result="$root/docs/results/$(date +%F)-round-5-dry-run.md"

started=$(date +%s)
uv run --package parfocal-deploy python -m parfocal_deploy.study seed "$code" --seat "$PARFOCAL_SMOKE_EMAIL"
seed_seconds=$(($(date +%s) - started))

set +e
(
  cd "$root/apps/web"
  PARFOCAL_STUDY_CODE="$code" PLAYWRIGHT_JSON_OUTPUT_NAME="$report" \
    pnpm exec playwright test -c playwright.smoke.config.ts smoke/study-round5.spec.ts \
    --workers=1 --reporter=list,json
)
status=$?
set -e

python3 "$root/scripts/study_dry_run_result.py" "$report" "$code" "$seed_seconds" > "$result"
echo "Wrote $result. Remove the project with: uv run --package parfocal-deploy python -m parfocal_deploy.study remove $code"
exit "$status"
