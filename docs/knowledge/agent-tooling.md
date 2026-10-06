# Agent tooling for the platform

Which MCP servers and CLIs let an agent inspect and change each service in [ADR 0003](../adr/0003-pilot-platform-architecture.md). The project-level MCP config is [`.mcp.json`](../../.mcp.json). Each remote server asks for OAuth or a token the first time it is used.

| Service | Official MCP | CLI | What an agent can do |
|---|---|---|---|
| Cloudflare | Yes, several remote servers. `bindings.mcp.cloudflare.com` for Workers, KV, R2, D1, Durable Objects and Hyperdrive, `observability.mcp.cloudflare.com` for Workers Logs, plus docs and builds servers | `wrangler` | Inspect and edit buckets and bindings, read Worker logs and errors, deploy |
| Neon | Yes, remote at `mcp.neon.tech/mcp` | `neonctl` | Create and reset branches, run SQL, compare schemas, test migrations on a temporary branch, list slow queries |
| Modal | No official server. Community servers exist (Flux159, george-bobby) | `modal` | Deploy, serve, read logs, manage secrets and volumes through the CLI. Prefer the CLI over an unofficial server holding the Modal token |
| Zitadel | No official server. One small community server (takleb3rry/zitadel-mcp) | The Zitadel Terraform provider and the Management API | Keep the Zitadel project, apps and roles as OpenTofu code in `infra/tofu` and let the agent edit that |
| Sentry | Yes, remote at `mcp.sentry.dev/mcp` | `sentry-cli` | Query issues, stack traces and events |
| PostHog | Yes, remote at `mcp.posthog.com/mcp` | | Manage feature flags and experiments, query analytics, read surveys |
| Grafana | Yes, `grafana/mcp-grafana`, run locally with a Grafana URL and service account token | | Query dashboards, Prometheus, Loki and Tempo, manage alerts. Add it to `.mcp.json` once the Grafana Cloud stack exists |
| Resend | Yes, remote at `mcp.resend.com/mcp` | | Manage domains, API keys, webhooks and send test emails |
| GitHub | Not needed | `gh` | Pull requests, Actions runs, secrets |

Checked on 2026-10-06. Sources: https://blog.cloudflare.com/thirteen-new-mcp-servers-from-cloudflare, https://neon.com/docs/ai/neon-mcp-server, https://docs.sentry.io/product/sentry-mcp/, https://resend.com/changelog/mcp, https://grafana.com/docs/grafana-cloud/ai-tools/mcp-servers/oss-mcp/.

## Provisioned resources

No secrets here. Secrets live in `.env` locally and in GitHub environments for CI.

| Service | Resource | Notes |
|---|---|---|
| Cloudflare | Account `ecd7fda10e3d9ff42ecc86cb43073fcd` | Workers on the free plan for now. R2 subscription active |
| Cloudflare | Zone `parfocal.eu` | Active since 2026-10-06. Nameservers `hunts.ns.cloudflare.com` and `stella.ns.cloudflare.com`, set at the registrar Endora (admin.endora.cz). An unused `pathocal.eu` zone from a typo can be deleted |
| Cloudflare R2 | Buckets `parfocal-dev`, `parfocal-staging`, `parfocal-prod` | Managed by `infra/tofu`. Public access off. Token "parfocal-dev local" has Object Read & Write on `parfocal-dev` only |
| Cloudflare R2 | Bucket `parfocal-tfstate` | Encrypted OpenTofu state. Created by hand |
| Cloudflare | Account token `parfocal-tofu` | Used by `infra/tofu`. See [infra.md](infra.md) |
| Neon | Project `soft-pine-86468744`, database `parfocal` | Created through the Vercel Marketplace (team "fedasevich's projects"), free plan, US East (`iad1`), Neon Auth off. Personal API keys are available in the Neon console |
| Zitadel Cloud | Instance `parfocal` at `https://parfocal-iqcyh5.eu1.zitadel.cloud`, organisation `Parfocal` (`393969446668073456`) | EU region, free plan. The customer-portal team is still named "pathocal" |
| Zitadel Cloud | Project `Parfocal`, OIDC apps `parfocal-api-dev`, `-staging`, `-prod`, service user `parfocal-tofu` (Org Owner) | Project and apps managed by `infra/tofu`. The dev app's client ID and secret are in `.env` |
| Modal | Workspace `fedasevich`, environments `main` (production), `dev`, `staging` | Starter plan. CLI token in `~/.modal.toml` |
| GitHub | `fedasevich/parfocal` | Public. Linked as `origin`. Ruleset "main requires ci-ok" (id 24612221) with admin bypass. Workflows from outside contributors need approval |
