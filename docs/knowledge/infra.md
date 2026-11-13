# Infrastructure as code

How `infra/tofu` works and the traps found while setting it up. It is the result of OPS-001 (base infrastructure as code) under [ADR 0287](../adr/0287-one-opentofu-root-per-environment-over-a-shared-module.md) (one OpenTofu root per environment), [ADR 0288](../adr/0288-conftest-checks-the-opentofu-code-and-every-plan.md) (conftest checks the code and every plan) and [ADR 0289](../adr/0289-opentofu-owns-buckets-zone-settings-and-zitadel-only.md) (what OpenTofu owns).

## Layout

| Directory | State key in `parfocal-tfstate` | What it manages |
|---|---|---|
| `global` | `global.tfstate` | Zone settings on `parfocal.eu` (HTTPS only, TLS 1.2 minimum, TLS 1.3, strict SSL) and the Zitadel project `Parfocal` |
| `dev` | `dev.tfstate` | `modules/environment` for `http://localhost:5173`, with Zitadel `dev_mode` on |
| `staging` | `staging.tfstate` | `modules/environment` for `https://staging.parfocal.eu` |
| `prod` | `prod.tfstate` | `modules/environment` for `https://app.parfocal.eu` |
| `modules/environment` | none | Bucket `parfocal-<name>` with `prevent_destroy`, its upload CORS rule (the app origin, `PUT`, `Content-Type`, `ETag` exposed, 3600 s), a rule that aborts incomplete multipart uploads under `t/` after 1 day, and the confidential OIDC app `parfocal-api-<name>` |
| `policy` | none | Rego rules and their tests |

All four roots are applied and plan clean since 2026-11-13.

Not managed here, on purpose: Neon (projects are made by the owner in the Vercel dashboard, branches by OPS-002 through the Neon API), Modal, Workers and the hostnames `staging.parfocal.eu` and `app.parfocal.eu` (Workers Custom Domains in Wrangler), all of which belong to OPS-002 (deploy definitions). Also not managed: the old web host's DNS records and the `parfocal-tfstate` bucket itself.

## Running it

Always go through the wrapper, which loads `.env` and turns the Cloudflare token into R2 S3 credentials for the state backend. The first argument is the root.

```
infra/tofu/tofu.sh staging init
infra/tofu/policy.sh plan staging
infra/tofu/tofu.sh staging plan -out=change.tfplan
infra/tofu/tofu.sh staging apply change.tfplan
```

Apply `global` first when a change touches both, then `dev`, `staging` and `prod` in that order.

It needs three things on the machine:

| Item | Where | Notes |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | `.env` | Account token `parfocal-tofu` with Workers R2 Storage Write on the account, and DNS Write, Zone Read and Zone Settings Write on `parfocal.eu`. No Workers permission |
| `TF_VAR_state_passphrase` | `.env` | Encrypts state and plans of every root. Keep a copy in a password manager. Losing it makes the state unreadable |
| Zitadel key | `~/.config/parfocal/zitadel-sa.json` (mode 600) | JSON key of the service user `parfocal-tofu`, which is Org Owner of `Parfocal` |

## Outputs, the handoff to deploys

| Root | Outputs |
|---|---|
| `dev`, `staging`, `prod` | `app_origin`, `slide_bucket`, `zitadel_issuer`, `zitadel_client_id` (sensitive), `zitadel_client_secret` (sensitive) |
| `global` | `zone_id`, `zitadel_issuer`, `zitadel_project_id` |

Read them with `tofu.sh <root> output -json` and pipe the values straight into `.env`, a Modal secret or a Wrangler secret without printing.

## Policy check

| Command | Needs | Refuses |
|---|---|---|
| `infra/tofu/policy.sh static` | conftest (`brew install conftest`), no credentials | A resource type off the free list in `policy/allowed.rego`, a bucket without `prevent_destroy`, a root with the wrong state key or without enforced encryption, an unknown or unpinned provider, a DNS record for `staging` or `app`, `dev_mode` or an http origin outside dev, a weaker TLS zone setting. Runs the rule tests first |
| `infra/tofu/policy.sh plan <root>` | conftest and the credentials above | A plan that deletes or replaces anything, or creates a type off the free list |

Run the plan check before every apply. A plan that deletes or replaces needs the owner's yes in chat ([ADR 0151](../adr/0151-standing-approval-for-production-within-30-dollars.md), standing approval within $30 a month). Adding a resource type means adding it to `policy/allowed.rego` and, when it can bill, a cap or alert row in [platform.md](platform.md).

CI (`.github/workflows/infra.yml`) runs `tofu fmt -check`, `init -backend=false` and `validate` in every root, `conftest fmt --check` and `policy.sh static`. It holds no credentials and never plans or applies.

## Gotchas

### R2 state credentials come from the API token

The S3 backend needs an access key pair. For an R2-capable Cloudflare token, the access key ID is the token's ID and the secret is the SHA-256 hex digest of the token value. `tofu.sh` derives both through the account `tokens/verify` endpoint, so no separate R2 key is stored.

### Zitadel resources need an explicit org_id

Without `org_id`, every plan after the first wanted to replace all OIDC apps, which would rotate their client secrets. The provider stores the org ID but treats a missing config value as a change that forces replacement. Set `org_id = var.zitadel_org_id` on every Zitadel resource, and set the app defaults (`id_token_role_assertion`, `access_token_role_assertion`, `additional_origins`, `skip_native_app_success_page`) explicitly so the plan stays empty.

### Granting a service user admin rights is a manual step

Adding `parfocal-tofu` as Org Owner and downloading its key were done by the owner in the Zitadel console. An agent must not grant permissions on its own.

### Cloudflare zone settings cannot be destroyed

`cloudflare_zone_setting` resources stay in the API after `tofu destroy`. Change their values instead of removing them.

### Move state, never import it again, when the layout changes

The OIDC client secrets exist only in the state. On 2026-11-13 the single root was split by `state pull` of the old state, `state push` of that file into each new root's empty key (a plaintext file is accepted and stored encrypted), `state rm` of the addresses that belong to other roots and `state mv` into `module.environment`. The pulled file is plaintext with secrets, so keep it outside the repository and delete it afterwards. Old outputs stay in a pushed state until the first apply, so apply each root once even when no resource changes.

### A new root's state commands fail until something is pushed

`tofu state list` exits with "No state file was found" on an empty key. That is the sign that a push is safe.
