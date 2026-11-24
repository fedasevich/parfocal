#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

out="${PARFOCAL_MAIN_PATH_OUT:-$root/.main-paths}"
runs="${PARFOCAL_MAIN_PATH_RUNS:-20}"
mkdir -p "$out"
status=0

conditions() {
  local pages
  pages="$(vm_stat | awk '/Pages (free|inactive|speculative)/ {gsub("\\.", "", $NF); sum += $NF} END {print sum}')"
  echo "$(date -u +%FT%TZ) available $((pages * 16384 / 1048576)) MiB, load $(sysctl -n vm.loadavg)"
}

for count in ${PARFOCAL_MAIN_PATH_COUNTS:-1000 10000}; do
  conditions | tee -a "$out/conditions.txt"
  PARFOCAL_MAIN_PATH_ANNOTATIONS="$count" PARFOCAL_MAIN_PATH_RUNS="$runs" \
    PARFOCAL_BENCH_OUT="$out/exports-$count.json" \
    uv run pytest apps/api/tests/test_export_main_paths.py -m db -q -p no:randomly >"$out/exports-$count.txt" 2>&1 ||
    status=1
  tail -1 "$out/exports-$count.txt"
  conditions | tee -a "$out/conditions.txt"
done
exit "$status"
