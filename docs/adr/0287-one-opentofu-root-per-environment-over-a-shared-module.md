# 0287. Each environment is its own OpenTofu root over a shared module, with one encrypted state file per root

- Date: 2026-11-13
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: OPS-001 (base infrastructure as code). Sets the handoff for OPS-002 (deploy definitions), IAM-001 (identity provider setup as code) and SKEL-001 (staging environment exists)

## Context

Until now `infra/tofu` was one root with one state file, `parfocal.tfstate`, and a map of three environments that every resource looped over with `for_each`. One plan covered dev, staging and production together. The owner's rules ([ADR 0151](0151-standing-approval-for-production-within-30-dollars.md), standing approval for production within $30 a month) treat staging and production differently, so a plan must be able to touch staging without reading or risking production. OPS-001 is done when `tofu plan` is clean for staging and for production, which also assumes two plans.

Two facts limit how the layout can change. The OIDC client secrets exist only in the state, and the Zitadel provider replaces an app on small differences, which rotates its secret. So state has to be moved, never imported again.

## Options considered

1. Keep one root with `for_each` over environments. Nothing to migrate, but every apply holds the production state lock and can change production, and a `-target` flag is the only separation.
2. One root with OpenTofu workspaces. One copy of the code, but the environment is invisible shell state, a wrong `workspace select` applies staging code to production, and resources that exist once (the zone, the Zitadel project) fit no workspace.
3. One root with a partial backend configuration chosen at `init`. Same code, separate state, but switching environments means `init -reconfigure`, which is as easy to get wrong as a workspace.
4. One root directory per environment (`global`, `dev`, `staging`, `prod`) over a shared module `modules/environment`, each with its own state key. A few small files are repeated, the environment is the directory name, and a policy can read it.

## Decision

Option 4. It is the only layout where a staging change cannot reach production by a forgotten flag, and where the policy check ([ADR 0288](0288-conftest-checks-the-opentofu-code-and-every-plan.md), conftest checks the code and every plan) can see which environment a file belongs to.

| Part | Choice |
|---|---|
| Roots | `infra/tofu/global` holds what exists once: the `parfocal.eu` zone settings and the Zitadel project `Parfocal`. `dev`, `staging` and `prod` each call `modules/environment` with a name, an app origin and `dev_mode` |
| Module | The slide bucket `parfocal-<name>` with `prevent_destroy`, its upload CORS rule, its rule that aborts incomplete uploads after a day, and the OIDC app `parfocal-api-<name>` |
| State | R2 bucket `parfocal-tfstate`, key `<root>.tfstate`, lock file on, state and plans encrypted on the client with one passphrase (`TF_VAR_state_passphrase`) |
| Shared values | An environment root finds the Zitadel project with a data source by name. No root reads another root's state, so no root needs another root's secrets |
| Versions | OpenTofu 1.13 in CI, `required_version >= 1.10` (client-side encryption and the S3 lock file). Providers `cloudflare/cloudflare ~> 5.27` and `zitadel/zitadel ~> 3.8`, with a committed lock file in every root |
| Wrapper | `infra/tofu/tofu.sh <root> <tofu arguments>` |
| Handoff to OPS-002 | Every environment root outputs `app_origin`, `slide_bucket`, `zitadel_issuer`, `zitadel_client_id` and `zitadel_client_secret` (the last two sensitive). `global` outputs `zone_id`, `zitadel_issuer` and `zitadel_project_id` |

The state was moved on 2026-11-13 by pulling the old state, pushing it into each new key, removing the addresses that belong elsewhere and renaming the rest with `state mv`. The first plan of `global` and `dev` showed no resource change, and `staging` and `prod` showed the same two additions each that the old root showed (the CORS and upload cleanup rules). No app was replaced and no secret rotated.

## Consequences

- A change to `modules/environment` reaches an environment only when that root is applied, so staging gets it first and production after.
- One passphrase still opens all four states. Separate passphrases per environment are possible later without moving state again.
- Whether Zitadel should have one project or one organisation per environment is left to IAM-001. Moving an app to another project is a replace that rotates its secret, so it is cheap only before staging has users.
- The old key `parfocal.tfstate` is still in the bucket as an unused copy. Deleting it is the owner's call, decision 87 in `docs/decisions.md`.
- `docs/knowledge/infra.md` describes the layout and the commands.

On 2026-11-13 [ADR 0293](0293-production-only-until-the-first-real-user.md) (production only until the first real user) cut the staging environment. The `staging` root and its state stay in the repository unused and are not applied until staging returns, so a module change now reaches `dev` and then `prod`.
