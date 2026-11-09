#!/bin/bash
source "$(dirname "$0")/env.sh"
git -C "$LEAD" fetch -q origin
SHA="$(git -C "$LEAD" rev-parse origin/main)"
echo "Head ${SHA:0:8}"
gh run list --commit "$SHA" --json name,status,conclusion \
  --jq '.[] | "\(if .conclusion == "failure" then "RED" elif .conclusion == "success" then "GREEN" else "WAIT" end) \(.name) \(.status) \(.conclusion)"'
echo "Last finished ci run on main"
gh run list --workflow ci --branch main --event push --status completed --limit 20 --json conclusion,headSha,createdAt \
  --jq '[.[] | select(.conclusion != "cancelled")][0] | "\(if .conclusion == "success" then "GREEN" else "RED" end) \(.headSha[0:8]) \(.createdAt)"'
