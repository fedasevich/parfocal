#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
cd "$here"

project="${IDP_SCRATCH_PROJECT:-parfocal-idp-scratch}"
export IDP_SCRATCH_PORT="${IDP_SCRATCH_PORT:-8189}"
export PARFOCAL_ZITADEL_PORT="$IDP_SCRATCH_PORT"
export PARFOCAL_MAILPIT_PORT="${IDP_SCRATCH_MAILPIT_PORT:-8125}"
export PARFOCAL_ZITADEL_STATE="$here/bootstrap"
export TF_VAR_zitadel_port="$IDP_SCRATCH_PORT"
compose=(docker compose -p "$project" -f "$root/infra/local/zitadel.compose.yaml")

wipe() {
  "${compose[@]}" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf bootstrap terraform.tfstate terraform.tfstate.backup
}

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    "${compose[@]}" logs --tail 100 zitadel 2>/dev/null || true
  fi
  wipe
}
trap cleanup EXIT

start_empty() {
  wipe
  mkdir -p bootstrap
  "${compose[@]}" up --detach --wait --wait-timeout 300
  waited=0
  until [ -s bootstrap/admin.pat ]; do
    if [ "$waited" -ge 60 ]; then
      echo "the bootstrap token was not written" >&2
      exit 1
    fi
    waited=$((waited + 2))
    sleep 2
  done
  TF_VAR_zitadel_access_token="$(tr -d '\n' < bootstrap/admin.pat)"
  export TF_VAR_zitadel_access_token
  export IDP_SCRATCH_TOKEN="$TF_VAR_zitadel_access_token"
}

TF_VAR_test_user_password="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
export TF_VAR_test_user_password
export IDP_SCRATCH_PASSWORD="$TF_VAR_test_user_password"

tofu init -input=false -no-color

start_empty
tofu apply -input=false -auto-approve -no-color
tofu plan -input=false -detailed-exitcode -no-color
python3 check.py

start_empty
tofu apply -input=false -auto-approve -no-color
tofu plan -input=false -detailed-exitcode -no-color
python3 check.py
