#!/bin/bash
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
BASE="${1:-main}"
MERGE_BASE="$(git merge-base "$BASE" HEAD)"
CHANGED="$( { git diff --name-only --diff-filter=d "$MERGE_BASE"; git ls-files --others --exclude-standard; } | sort -u)"
if [ -z "$CHANGED" ]; then echo "verify-changed: nothing changed against $BASE"; exit 0; fi

JS=$(echo "$CHANGED" | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|css)$' || true)
TS=$(echo "$CHANGED" | grep -E '\.(ts|tsx|js|jsx|mjs|cjs)$' || true)
PY=$(echo "$CHANGED" | grep -E '\.py$' || true)
STATUS=0

run() { echo "== $1"; shift; "$@" || STATUS=1; }

[ -n "$JS" ] && run biome pnpm -s biome check --diagnostic-level=warn --no-errors-on-unmatched $JS
[ -n "$TS" ] && run oxlint pnpm -s oxlint --type-aware --quiet $TS
[ -n "$PY" ] && run ruff uv run ruff check -q $PY
[ -n "$PY" ] && run ruff-format uv run ruff format --check -q $PY
if echo "$CHANGED" | grep -q '^infra/tofu/'; then
  run tofu-fmt tofu fmt -check -recursive infra/tofu
  run tofu-policy bash infra/tofu/policy.sh static
fi
echo "$CHANGED" | grep -q '^scripts/.*\.ts$' && run tsc-scripts pnpm -s tsc --noEmit -p scripts
run old-word python3 scripts/guard_old_word.py
run turbo pnpm -s turbo run typecheck test --output-logs=errors-only --filter="...[$MERGE_BASE]"

[ $STATUS -eq 0 ] && echo "verify-changed: OK" || echo "verify-changed: FAILED"
exit $STATUS
