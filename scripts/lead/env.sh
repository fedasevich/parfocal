#!/bin/bash
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAIN="$(dirname "$(git -C "$HERE" rev-parse --path-format=absolute --git-common-dir)")"
LEAD="${PARFOCAL_LEAD:-$(dirname "$MAIN")/parfocal-wt/lead}"
if [ ! -d "$LEAD" ]; then
  git -C "$MAIN" fetch -q origin
  git -C "$MAIN" worktree add -q --detach "$LEAD" origin/main
fi
COUNTER="$(git -C "$LEAD" rev-parse --path-format=absolute --git-dir)/lead-unpushed"
PUSH_EVERY="${PARFOCAL_PUSH_EVERY:-3}"
