#!/bin/bash
source "$(dirname "$0")/env.sh"
"$HERE/sync.sh" || exit 1
cd "$LEAD"
BASE=$(git rev-parse HEAD)
for B in "$@"; do
  if ! git merge -q --no-edit "$B" >/dev/null 2>&1; then echo "MERGE CONFLICT $B"; git diff --name-only --diff-filter=U; git merge --abort; exit 1; fi
  echo "merged $B"
done
python3 "$HERE/number_adrs.py"
if [ -n "$(git status --porcelain docs/adr)" ]; then git add -A docs; git commit -q -m "docs: Number the ADRs from the merge" 2>&1 | grep "✖"; fi
pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 || pnpm install --prefer-offline 2>&1 | tail -2
TURBO_CONCURRENCY=1 nice -n 10 pnpm -s turbo run typecheck --output-logs=errors-only --filter="...[$BASE]" > /tmp/claude-quick-merge.log 2>&1 || { echo "TYPECHECK FAILED"; tail -30 /tmp/claude-quick-merge.log; exit 1; }
echo QUICK-MERGED-OK
