# Infrastructure as code

How `infra/tofu` works and the traps found while setting it up. It implements the OpenTofu part of OPS-001 under [ADR 0003](../adr/0003-pilot-platform-architecture.md).

## What it manages

| Resource | File |
|---|---|
| Zone settings on `parfocal.eu` (HTTPS only, TLS 1.2 minimum, TLS 1.3, strict SSL) | `cloudflare.tf` |
| R2 buckets `parfocal-dev`, `parfocal-staging`, `parfocal-prod` with `prevent_destroy` | `cloudflare.tf` |
| Zitadel project `Parfocal` and one confidential OIDC app per environment (`parfocal-api-dev`, `-staging`, `-prod`) | `zitadel.tf` |

Not managed yet: DNS records, the Neon project (created through the Vercel Marketplace), Modal environments and the `parfocal-tfstate` bucket itself. TODO: decide in OPS-001 whether Neon moves under OpenTofu.

## Running it

Always go through the wrapper, which loads `.env` and turns the Cloudflare token into R2 S3 credentials for the state backend.

```
infra/tofu/tofu.sh init
infra/tofu/tofu.sh plan -out=change.tfplan
infra/tofu/tofu.sh apply change.tfplan
```

It needs three things on the machine:

| Item | Where | Notes |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `.env` | Account token `parfocal-tofu` with Workers R2 Storage Write on the account, and DNS Write, Zone Read and Zone Settings Write on `parfocal.eu` |
| `TF_VAR_state_passphrase` | `.env` | Encrypts state and plans. Keep a copy in a password manager. Losing it makes the state unreadable |
| Zitadel key | `~/.config/parfocal/zitadel-sa.json` (mode 600) | JSON key of the service user `parfocal-tofu`, which is Org Owner of `Parfocal` |

Outputs `zitadel_client_ids` and `zitadel_client_secrets` are sensitive. Read them with `tofu.sh output -json` and write them straight into `.env` without printing.

CI runs `tofu fmt -check`, `tofu init -backend=false` and `tofu validate` in `.github/workflows/infra.yml`. It holds no credentials and never plans or applies.

## Gotchas

### R2 state credentials come from the API token

The S3 backend needs an access key pair. For an R2-capable Cloudflare token, the access key ID is the token's ID and the secret is the SHA-256 hex digest of the token value. `tofu.sh` derives both through the account `tokens/verify` endpoint, so no separate R2 key is stored.

### Zitadel resources need an explicit org_id

Without `org_id`, every plan after the first wanted to replace all OIDC apps, which would rotate their client secrets. The provider stores the org ID but treats a missing config value as a change that forces replacement. Set `org_id = var.zitadel_org_id` on every Zitadel resource, and set the app defaults (`id_token_role_assertion`, `access_token_role_assertion`, `additional_origins`, `skip_native_app_success_page`) explicitly so the plan stays empty.

### Granting a service user admin rights is a manual step

Adding `parfocal-tofu` as Org Owner and downloading its key were done by the owner in the Zitadel console. An agent must not grant permissions on its own.

### Cloudflare zone settings cannot be destroyed

`cloudflare_zone_setting` resources stay in the API after `tofu destroy`. Change their values instead of removing them.
