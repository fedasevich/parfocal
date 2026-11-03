#!/bin/bash
source "$(dirname "$0")/env.sh"
"$HERE/sync.sh" >/dev/null || { echo "PUSH SYNC CONFLICT"; exit 1; }
cd "$LEAD" || exit 1
git push -q origin HEAD:main 2>&1 | grep -i "error\|reject" || echo "PUSHED $(git log --oneline -1)"
echo 0 > "$COUNTER"
