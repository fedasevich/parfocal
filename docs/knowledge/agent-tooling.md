# Agent tooling for the platform

Which MCP servers and CLIs let an agent inspect and change each service in [ADR 0003](../adr/0003-pilot-platform-architecture.md). The project-level MCP config is [`.mcp.json`](../../.mcp.json). Each remote server asks for OAuth or a token the first time it is used.

| Service | Official MCP | CLI | What an agent can do |
|---|---|---|---|
| Cloudflare | Only the docs server `docs.mcp.cloudflare.com` is in `.mcp.json`. The bindings and observability servers are deprecated and were removed on 2026-11-15 by SEC-031 (hard stops for destructive agent actions) | `wrangler` | Inspect buckets and bindings, read Worker logs with `wrangler tail`, deploy |
| Neon | Yes, remote at `mcp.neon.tech/mcp` | `neonctl` | Create branches, run SQL, compare schemas, test migrations on a temporary branch, list slow queries |
| Modal | No official server. Community servers exist (Flux159, george-bobby) | `modal` | Deploy, serve, read logs, manage secrets and volumes through the CLI. Prefer the CLI over an unofficial server holding the Modal token |
| Zitadel | No official server. One small community server (takleb3rry/zitadel-mcp) | The Zitadel Terraform provider and the Management API | Keep the Zitadel project, apps and roles as OpenTofu code in `infra/tofu` and let the agent edit that |
| Sentry | Yes, remote at `mcp.sentry.dev/mcp` | `sentry-cli` | Query issues, stack traces and events |
| PostHog | Yes, remote at `mcp.posthog.com/mcp` | | Manage feature flags and experiments, query analytics, read surveys |
| Grafana | Yes, `grafana/mcp-grafana`, run locally with a Grafana URL and service account token | | Query dashboards, Prometheus, Loki and Tempo, manage alerts. Add it to `.mcp.json` once the Grafana Cloud stack exists |
| Resend | Yes, remote at `mcp.resend.com/mcp` | | Manage domains, API keys, webhooks and send test emails |
| GitHub | Not needed | `gh` | Pull requests, Actions runs, secrets |

Checked on 2026-10-06. Sources: https://blog.cloudflare.com/thirteen-new-mcp-servers-from-cloudflare, https://neon.com/docs/ai/neon-mcp-server, https://docs.sentry.io/product/sentry-mcp/, https://resend.com/changelog/mcp, https://grafana.com/docs/grafana-cloud/ai-tools/mcp-servers/oss-mcp/.

## How an agent reaches each service

Checked on 2026-10-31. Follow the production rules in `AGENTS.md` before any write.

| Service | How | State on 2026-10-31 |
|---|---|---|
| Modal | `uvx modal ...`, which reads the token in `~/.modal.toml`. No install needed | Works. `uvx modal app list` showed no apps and `uvx modal volume list` no volumes |
| Vercel and Neon billing | The Vercel MCP server (`mcp__vercel__*`) | Works. Team `team_XVYHWaKthAXAuyUtbNBrD73r` |
| Neon database | `npx neonctl ...`, signed in by the owner on 2026-10-31. The project sits in the Vercel-made organisation, so pass `--org-id org-blue-credit-47472368` ("Vercel: fedasevich's projects", Free). That organisation also holds the owner's other projects, such as `neon-red-engine`, which the owner confirmed on 2026-11-02 is theirs and must be left alone (`viewer-ux-study-db`, `neon-mapa`, `wad`, `neon-red-engine`), which agents must not touch | Works |
| Cloudflare | `npx wrangler ...` after the owner runs `npx wrangler login` once. `CLOUDFLARE_API_TOKEN` in `.env` is the `parfocal-tofu` token for R2 and DNS until the owner makes the limited `parfocal-agent-dev-staging` token that `.env.example` names, limited to dev and staging. Its exact scopes are a TODO for the owner. Wrangler 4 loads `.env` from the current folder and then refuses OAuth, so run both `wrangler login` and later wrangler commands from outside the repo, for example `cd ~ && npx wrangler login` | Signed in by the owner on 2026-10-31. Wrangler 4.156 creates an empty `~/.wrangler` on first use and then looks for the login there instead of `~/Library/Preferences/.wrangler`, so commands other than `whoami` say "Not logged in". Since 2026-11-02 `~/.wrangler` is a symlink to `~/Library/Preferences/.wrangler`, which fixes it |
| Zitadel | OpenTofu in `infra/tofu` with the `parfocal-tofu` service user key | Works as before |
| GitHub | `gh`. Reading billing needs the `user` scope, which the owner adds with `gh auth refresh -h github.com -s user` | Billing not readable from the CLI yet |
| Billing pages | The owner's Chrome through Claude in Chrome, where the owner is signed in to Modal, Vercel, Cloudflare, Zitadel and GitHub | Works while the owner's sessions last |

## What agents are refused

`scripts/guard_destructive.py` runs before every `Bash` call, every MCP tool and the WebStorm terminal tool, set in `.claude/settings.json` by SEC-031 (hard stops for destructive agent actions). It exits 2 with the reason, so the call never runs, whatever the permission mode. `scripts/test_guard_destructive.py` lists every refused and allowed case.

- MCP tools of the cloud servers (Neon, Cloudflare, Vercel, Resend, Sentry, PostHog) whose name holds delete, remove, reset, restore, rotate, revoke, purge, destroy, drop, disable, rollback, pause, replace, buy or transfer, plus Neon `set_default_branch`. Examples are Neon `delete_project`, `delete_branch`, `reset_from_parent` and `restore_snapshot`, Cloudflare `r2_bucket_delete` and `kv_namespace_delete`, Vercel `delete_*` and `buy_domain`, and Resend `remove-*`.
- `tofu` or `terraform` with `destroy`, `-destroy`, `-replace`, `taint`, `force-unlock`, `state rm`, `state mv`, `state push` or `workspace delete`, also through `infra/tofu/tofu.sh`.
- `wrangler` with delete, remove, rm, purge or rollback, such as `wrangler r2 bucket delete`.
- `modal` stop, delete, rm, remove or rollback unless `--env dev` or `--env staging` is named. No environment means `main`.
- `neonctl` delete, reset, restore, reset-password or set-default, such as `neonctl branches delete`.
- `vercel` remove, rm, delete or rollback, `aws s3 rb`, `aws s3api delete-*`, `aws s3 rm` outside the tenant prefix `t/`, `rclone` purge or delete, `gh repo delete`, `gh secret delete`, `gh variable delete`, `gh api -X DELETE` and `curl -X DELETE` to any host but localhost.

The check reads each part of a command chain, `bash -c` strings, heredocs fed to a shell and scripts run with `bash path`. It skips quoted text, so commit messages and `grep` that mention these commands pass. It cannot see a command that a program builds at run time, nor what a plain `tofu apply` or a saved plan destroys, so reading the plan stays the agent's job. It is a hard stop for mistakes, not a sandbox. The local Zitadel check `infra/tofu/idp-scratch/run.sh` ends with `tofu destroy` on a throwaway container, so it is refused too and the owner runs it.

Allowed on purpose: git (merge, push, `branch -D`, `worktree remove`), `rm` in the repo or `/tmp`, `docker compose` for the local database, pnpm, uv, Playwright, deploys, `tofu plan` with any flag and `tofu apply` without destroy or replace, as ADR 0151 (standing approval within $30 a month) allows. The guard narrows the reseed yes of ADR 0293 (production only until the first real user). Deleting or resetting the Neon branch and `delete_postgres_database` now go to the owner, while SQL through `run_sql` and `aws s3 rm` under the tenant prefix `t/` are not refused.

When such an action is due, the agent writes the exact command and its cost in chat or `docs/decisions.md`, as ADR 0115 (production access and spend caps) asks. The owner runs it in their own terminal outside Claude Code, or in the service dashboard, and the agent logs it. No variable or flag lets an agent turn the guard off.

## Provisioned resources

No secrets here. Secrets live in `.env` locally and in GitHub environments for CI.

| Service | Resource | Notes |
|---|---|---|
| Cloudflare | Account `ecd7fda10e3d9ff42ecc86cb43073fcd` | Workers on the free plan for now. R2 subscription active |
| Cloudflare | Zone `parfocal.eu` | Active since 2026-10-06. Nameservers `hunts.ns.cloudflare.com` and `stella.ns.cloudflare.com`, set at the registrar Endora (admin.endora.cz). An unused `pathocal.eu` zone from a typo can be deleted |
| Cloudflare R2 | Buckets `parfocal-dev` (also the deployed app's slides until the first real user, ADR 0293), `parfocal-prod` (empty) | Managed by `infra/tofu`. Public access off. Token "parfocal-dev local" has Object Read & Write on `parfocal-dev` only |
| Cloudflare R2 | Bucket `parfocal-tfstate` | Encrypted OpenTofu state, one key per root (`global`, `dev`, `staging`, `prod`), plus the old `parfocal.tfstate` until the owner answers decision 87 (delete the old state file). Created by hand |
| Cloudflare | Account token `parfocal-tofu` | Used by `infra/tofu`. See [infra.md](infra.md) |
| Neon | Project `soft-pine-86468744`, database `parfocal` | Created through the Vercel Marketplace (team "fedasevich's projects"), free plan, US East (`aws-us-east-1`, `iad1`, kept by STACK-020), Neon Auth off. Personal API keys are available in the Neon console |
| Zitadel Cloud | Instance `parfocal` at `https://parfocal-iqcyh5.eu1.zitadel.cloud`, organisation `Parfocal` (`393969446668073456`) | EU region, free plan. The customer-portal team is still named "pathocal" |
| Zitadel Cloud | Project `Parfocal`, OIDC apps `parfocal-api-dev`, `-staging`, `-prod`, service user `parfocal-tofu` (Org Owner) | Project and apps managed by `infra/tofu`. The dev app's client ID and secret are in `.env` |
| Zitadel Cloud | Human user `e2e-pathologist@parfocal.eu` (id `394945461896722336`) | Created on 2026-10-13 through the v2 user API for the login E2E, not yet in `infra/tofu`. Password in `.env`. TODO: import it into OpenTofu in IAM-001 |
| Modal | Workspace `fedasevich`, environments `main` (production), `dev`, `staging` | Starter plan. CLI token in `~/.modal.toml` |
| GitHub | `fedasevich/parfocal` | Public. Linked as `origin`. Ruleset "main requires ci-ok" (id 24612221) with admin bypass. Workflows from outside contributors need approval |

## Committing when other agents edit the same working tree

Several agents can work in one checkout of `main` at once, so a file can hold another agent's uncommitted hunks next to yours. Stage files by name, and when a file has both, stage only your part without touching theirs: write HEAD's version plus your edits to a scratch file, then `git hash-object -w <file>` and `git update-index --cacheinfo 100644,<sha>,<path>`. Their changes stay in the working tree for them to commit. Before committing, check that nothing staged imports a file that is still untracked, because CI builds only what is committed. Source: PROTO-003 (home, My work and the shell over fake data).

## Claude Code cloud sessions

Each cloud session starts from a fresh container with Node 22, Python 3.13 and no Docker daemon. `scripts/cloud-setup.sh` installs Node and Python from `.node-version` and `.python-version`, betterleaks at the CI version, runs `pnpm install` and `uv sync`, copies `.env.example` to `.env` and starts Docker. The environment's setup script runs it with `cd parfocal && bash scripts/cloud-setup.sh`. `pnpm -s verify` passes there except the `latency-proxy` timing tests, which miss their tolerance under the parallel run and pass alone. Docker Hub rate-limits image pulls from the shared address, so `test:db` and `db:up` often fail. The MCP servers in `.mcp.json` are blocked by the proxy, the owner's `~/.claude/CLAUDE.md` style rules are not loaded, and there are no secrets, so cloud sessions suit code and docs tasks that need no real infrastructure. Checked on 2026-11-03.
