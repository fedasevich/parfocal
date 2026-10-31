# 0115. Agents may touch real infrastructure, read-only by default, with every production write approved by the owner and every billing service capped or alerted

- Date: 2026-10-31
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: OPS-009 (storage lifecycle and cost controls). Touches OPS-001 (base infrastructure as code), OPS-005 (continuous deployment), STACK-019 (the web framework), STACK-020 (database hosting) and IAM-001 (login provider setup)

## Context

From 2026-10-08 to 2026-10-31 no agent touched the cloud. On 2026-10-31 the owner opened Modal, Neon and the Zitadel credentials again and asked that agents can sometimes touch the real infrastructure, that budgets and alerts be set everywhere, and that agents be extra careful. The owner pays for every service personally. Production holds the pilot's real data later, so one wrong command can lose data, leak it or run up a bill.

The services today are Cloudflare (Workers, R2 and the `parfocal.eu` zone), Modal (environments `main`, `dev` and `staging`), Neon (project `soft-pine-86468744`, billed through Vercel), Zitadel Cloud, Vercel (the team that holds the Neon integration) and GitHub. Sentry, PostHog, Resend and Grafana have no accounts yet.

## Options considered

1. Keep agents off the cloud and have the owner run every command. Safest, but the owner must do work an agent can do, and STACK-019, STACK-020 and IAM-001 stay blocked.
2. Give agents full access and rely on the rules in `AGENTS.md`. Fast, but a rule only works if every agent reads it and gets it right, and nothing stops a runaway job.
3. Give agents access, keep production read-only unless the owner approves each write, and let the providers enforce money limits themselves where they can, with alerts where they cannot.

## Decision

Option 3. Hard caps set in each provider stop spending even when an agent makes a mistake, and the approval rule keeps production writes in the owner's hands.

Production means Modal environment `main`, the Neon main branch, the R2 buckets `parfocal-prod` and `parfocal-tfstate`, DNS and settings of the `parfocal.eu` zone, the Zitadel instance with its `parfocal-api-prod` app and organisation settings, any `tofu apply`, GitHub repository settings, secrets and rulesets, and every billing, plan or limit setting in any provider.

- Reading production (lists, logs, usage, `tofu plan`) is allowed.
- A write to production needs the owner's yes in chat for that exact action in the current conversation. Approval never carries over to a later action or session.
- Before the yes, the agent shows the exact command or the plan diff and what it costs.
- Agents never delete, purge, destroy, force or rotate anything in production, and never raise a limit, add a payment method, change a plan or accept terms. The owner does those.
- Dev and staging are used for everything that can be done there. Things an agent creates for a test are deleted when the test ends.
- Every production touch, read-only checks of spend aside, gets a log entry saying what changed and why.
- Every service that can bill has a hard cap in the provider, or an alert at the lowest useful threshold where no cap exists. A new service gets its cap or alert the day it is created. The table in [knowledge/platform.md](../knowledge/platform.md) lists each one.

## Consequences

Agents can now measure Modal cold starts (STACK-019) and the Neon region (STACK-020) in dev, and set up Zitadel from code (IAM-001), without asking for each read. Production deploys still need the owner. The rule is in `AGENTS.md` under "Real infrastructure and production". OPS-009 keeps its budgets per environment and cost dashboards, and this record covers the account-level caps.
