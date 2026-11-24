#!/usr/bin/env bash
set -euo pipefail

: "${PARFOCAL_SMOKE_EMAIL:?the email of an account with admin rights in the workspace it signs in to}"
: "${PARFOCAL_SMOKE_PASSWORD:?the password of that account}"

root="$(cd "$(dirname "$0")/.." && pwd)"
report="$root/apps/web/test-results/study-prepare-dry-run.json"
result="$root/docs/results/$(date +%F)-study-prepare-dry-run.md"

set +e
(
  cd "$root/apps/web"
  PARFOCAL_STUDY_PREPARE=1 PLAYWRIGHT_JSON_OUTPUT_NAME="$report" \
    pnpm exec playwright test -c playwright.smoke.config.ts smoke/study-prepare.spec.ts \
    --workers=1 --reporter=list,json
)
status=$?
set -e

python3 "$root/scripts/study_dry_run_result.py" --prepared "$report" > "$result"
echo "Wrote $result"
exit "$status"
