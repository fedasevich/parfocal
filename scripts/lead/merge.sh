#!/bin/bash
set -e
source "$(dirname "$0")/env.sh"
ID="$1"; BRANCH="$2"; LOG="$3"; MODE="${4:-tick}"
VERIFY_LOG="$(dirname "$COUNTER")/verify-$ID.log"
"$HERE/sync.sh" || exit 1
cd "$LEAD"
if ! git merge -q --no-edit "$BRANCH" >/dev/null 2>&1; then
  echo "MERGE CONFLICT"; git diff --name-only --diff-filter=U; git merge --abort; exit 1
fi
python3 "$HERE/number_adrs.py"
if [ -n "$(git status --porcelain docs/adr)" ]; then
  git add -A docs
  git commit -q -m "docs($ID): Number the ADR from the merge" 2>&1 | grep "✖" || true
fi
pnpm install --frozen-lockfile --prefer-offline >/dev/null 2>&1 || pnpm install --prefer-offline 2>&1 | tail -2
if ! pnpm -s verify > "$VERIFY_LOG" 2>&1; then echo "VERIFY FAILED"; tail -30 "$VERIFY_LOG"; exit 1; fi
python3 scripts/board.py note "$LOG"
if [ "$MODE" = tick ]; then python3 scripts/board.py tick "$ID"; else python3 scripts/board.py move "$ID" review --note "$MODE"; fi
python3 scripts/board.py check
git add docs/BACKLOG.md docs/log.md docs/board/active
git commit -q -m "docs($ID): Log and tick after merge" 2>&1 | grep "✖" || true
n=$(( $(cat "$COUNTER" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$COUNTER"
if [ "$n" -ge "$PUSH_EVERY" ]; then "$HERE/push.sh"; fi
git log --oneline -3
W=$(git -C "$MAIN" worktree list | grep "\[$BRANCH\]" | cut -d" " -f1)
if [ -n "$W" ]; then git -C "$MAIN" worktree remove -f -f "$W"; fi
git -C "$MAIN" branch -q -D "$BRANCH"
"$HERE/sync.sh"
echo MERGED-OK
