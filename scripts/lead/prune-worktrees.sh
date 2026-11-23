#!/bin/bash
source "$(dirname "$0")/env.sh"
cd "$MAIN" || exit 1
git fetch -q origin main
removed=0
for dir in .claude/worktrees/*/; do
  [ -d "$dir" ] || continue
  head=$(git -C "$dir" rev-parse HEAD 2>/dev/null) || continue
  git merge-base --is-ancestor "$head" origin/main || continue
  [ -z "$(git -C "$dir" status --porcelain --untracked-files=no)" ] || continue
  gitdir=$(git -C "$dir" rev-parse --git-dir)
  [ -z "$(find "$gitdir/index" -mmin -60 2>/dev/null)" ] || continue
  git worktree remove --force "$dir" && removed=$((removed + 1))
done
git worktree prune
echo "PRUNED $removed merged agent worktrees"
