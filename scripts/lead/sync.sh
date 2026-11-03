#!/bin/bash
source "$(dirname "$0")/env.sh"
cd "$LEAD" || exit 1
git fetch -q origin
if ! git merge-base --is-ancestor origin/main HEAD; then
  git merge -q --no-edit origin/main >/dev/null 2>&1 || { echo "SYNC CONFLICT"; git merge --abort; exit 1; }
fi
git -C "$MAIN" merge -q --ff-only "$(git rev-parse HEAD)" 2>/dev/null || echo "main checkout not fast-forwarded"
