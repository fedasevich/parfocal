#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
state="$root/.zitadel"
compose=(docker compose -f "$root/infra/local/zitadel.compose.yaml")
issuer="http://localhost:8089"

mkdir -p "$state"
if ! docker volume inspect parfocal-zitadel_zitadel-db >/dev/null 2>&1; then
  rm -f "$state/admin.pat" "$state/login-client.pat" "$state/e2e.env" "$state"/terraform.tfstate*
fi
"${compose[@]}" up --detach --wait --wait-timeout 300

waited=0
until [ -s "$state/admin.pat" ] && [ -s "$state/login-client.pat" ]; do
  if [ "$waited" -ge 60 ]; then
    echo "Zitadel did not write its bootstrap tokens" >&2
    exit 1
  fi
  waited=$((waited + 2))
  sleep 2
done

if [ ! -s "$state/test-password" ]; then
  python3 -c 'import secrets; print(secrets.token_urlsafe(18))' > "$state/test-password"
fi

TF_VAR_zitadel_access_token="$(tr -d '\n' < "$state/admin.pat")"
TF_VAR_test_user_password="$(tr -d '\n' < "$state/test-password")"
export TF_VAR_zitadel_access_token TF_VAR_test_user_password
export TF_DATA_DIR="$state/terraform"
export TF_VAR_app_origin="http://localhost:${PARFOCAL_E2E_PORT:-5173}"

tofu_dir="$root/infra/tofu/idp-local"
tofu -chdir="$tofu_dir" init -input=false -no-color >/dev/null
tofu -chdir="$tofu_dir" apply -input=false -auto-approve -no-color -state="$state/terraform.tfstate" >/dev/null

output() {
  tofu -chdir="$tofu_dir" output -raw -no-color -state="$state/terraform.tfstate" "$1"
}

login_token="$(tr -d '\n' < "$state/login-client.pat")"
login_client_id="$(curl -fsS -H "authorization: Bearer $login_token" "$issuer/auth/v1/users/me" | python3 -c 'import json, sys; print(json.load(sys.stdin)["user"]["id"])')"

umask 077
{
  echo "ZITADEL_ISSUER=$issuer"
  echo "ZITADEL_CLIENT_ID=$(output client_id)"
  echo "ZITADEL_CLIENT_SECRET=$(output client_secret)"
  echo "ZITADEL_ORGANIZATION_ID=$(output org_id)"
  echo "ZITADEL_LOGIN_CLIENT_ID=$login_client_id"
  echo "ZITADEL_LOGIN_TOKEN=$login_token"
  echo "ZITADEL_ADMIN_TOKEN=$TF_VAR_zitadel_access_token"
  echo "ZITADEL_TEST_USERNAME=e2e-pathologist@parfocal.test"
  echo "ZITADEL_TEST_PASSWORD=$TF_VAR_test_user_password"
  echo "MAILPIT_URL=http://localhost:8025"
} > "$state/e2e.env"

echo "Local Zitadel is up at $issuer. Settings are in .zitadel/e2e.env."
