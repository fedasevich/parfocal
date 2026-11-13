#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
mode="${1:?usage: policy.sh static | policy.sh plan global|dev|staging|prod}"

case "${mode}" in
  static)
    cd "${here}"
    conftest verify --policy policy
    conftest test --parser hcl2 --combine --ignore '\.terraform' --policy policy --namespace static \
      global dev staging prod modules
    ;;
  plan)
    root="${2:?usage: policy.sh plan global|dev|staging|prod}"
    work="$(mktemp -d)"
    trap 'rm -rf "${work}"' EXIT
    "${here}/tofu.sh" "${root}" plan -input=false -out="${work}/plan" >/dev/null
    "${here}/tofu.sh" "${root}" show -json "${work}/plan" >"${work}/plan.json"
    conftest test --policy "${here}/policy" --namespace plan "${work}/plan.json"
    ;;
  *)
    echo "unknown mode ${mode}, use static or plan" >&2
    exit 2
    ;;
esac
