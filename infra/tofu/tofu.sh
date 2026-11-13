#!/usr/bin/env bash
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
root="${1:?usage: tofu.sh global|dev|staging|prod <tofu arguments>}"
shift

case "${root}" in
  global | dev | staging | prod) ;;
  *)
    echo "unknown root ${root}, use global, dev, staging or prod" >&2
    exit 2
    ;;
esac

set -a
source "${here}/../../.env"
set +a

: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN in .env}"
: "${TF_VAR_state_passphrase:?set TF_VAR_state_passphrase in .env}"

account_id="${R2_ACCOUNT_ID}"
token_id="$(curl -fsS -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "https://api.cloudflare.com/client/v4/accounts/${account_id}/tokens/verify" \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["id"])')"

export AWS_ACCESS_KEY_ID="${token_id}"
export AWS_SECRET_ACCESS_KEY="$(printf '%s' "${CLOUDFLARE_API_TOKEN}" | shasum -a 256 | cut -d' ' -f1)"

exec tofu -chdir="${here}/${root}" "$@"
