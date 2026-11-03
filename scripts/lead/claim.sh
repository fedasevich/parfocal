#!/bin/bash
set -e
source "$(dirname "$0")/env.sh"
"$HERE/sync.sh"
cd "$LEAD"
for ID in "$@"; do python3 scripts/board.py claim "$ID" --by "claude parallel run" | tail -1; done
git add docs/board/active
git commit -q -m "chore($1): Claim $* for the parallel run" 2>&1 | grep "✖" || true
"$HERE/sync.sh"
