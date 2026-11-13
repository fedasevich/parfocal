#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker compose logs --tail 100 zitadel 2>/dev/null || true
  fi
  docker compose down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf bootstrap terraform.tfstate terraform.tfstate.backup
}
trap cleanup EXIT

cleanup
mkdir -p bootstrap
docker compose up --detach --wait --wait-timeout 300

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
TF_VAR_test_user_password="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
export TF_VAR_zitadel_access_token TF_VAR_test_user_password
export IDP_SCRATCH_TOKEN="$TF_VAR_zitadel_access_token"
export IDP_SCRATCH_PASSWORD="$TF_VAR_test_user_password"

tofu init -input=false -no-color
tofu apply -input=false -auto-approve -no-color
tofu plan -input=false -detailed-exitcode -no-color
python3 check.py
tofu destroy -input=false -auto-approve -no-color
tofu apply -input=false -auto-approve -no-color
python3 check.py
tofu destroy -input=false -auto-approve -no-color
