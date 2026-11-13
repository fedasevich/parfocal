# 0288. Conftest checks the OpenTofu code in CI and every plan before an apply, and a resource type list guards the cost

- Date: 2026-11-13
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: OPS-001 (base infrastructure as code). Used by OPS-005 (continuous deployment) and OPS-009 (storage lifecycle and cost controls)

## Context

OPS-001 is done when a policy check passes, and the backlog does not say which. Two things need checking. The code must keep the rules that are costly to break: no paid resource appears unnoticed ([ADR 0115](0115-production-access-and-spend-caps.md), production access and spend caps), slide buckets cannot be destroyed, state stays encrypted and separate per environment. A plan must never delete or replace anything without the owner's yes in chat ([ADR 0151](0151-standing-approval-for-production-within-30-dollars.md), standing approval within $30 a month). CI holds no cloud credentials, so whatever runs there cannot plan.

## Options considered

1. `tofu validate` with `validation` and `precondition` blocks only. No new tool, but it cannot see the backend, the providers or a whole plan, and cannot say "no other resource type".
2. A scanner with built-in rules, such as Trivy or Checkov. Hundreds of rules for AWS, Azure and Google Cloud, almost none for Cloudflare R2 or Zitadel, and none for this project's own rules.
3. Conftest with Rego rules written here, over the HCL files and over the plan as JSON. One small binary, rules with unit tests, runs without credentials on the code.
4. A Python script over `tofu show -json`. No new tool, but it needs a plan and so credentials, and reading HCL from Python needs a parser dependency anyway.

## Decision

Option 3, conftest 0.71 with the rules in `infra/tofu/policy`.

| Check | When | What it refuses |
|---|---|---|
| Static, `policy.sh static` | In CI on every infra change and locally, no credentials | A resource type that is not on the free list in `allowed.rego`. An R2 bucket without `prevent_destroy`. A root whose state is not in `parfocal-tfstate` under `<root>.tfstate` with a lock file and enforced state and plan encryption. A provider from another source or without a version. A DNS record for `staging` or `app`, which Wrangler owns ([ADR 0289](0289-opentofu-owns-buckets-zone-settings-and-zitadel-only.md), what OpenTofu owns). `dev_mode` or a plain http origin outside dev. A weaker TLS zone setting |
| Plan, `policy.sh plan <root>` | Before every apply, by whoever holds the credentials | Any delete or replace, and any resource type off the free list |

The cost guard is the type list. Everything on it costs nothing at this project's size: zone settings, DNS records, R2 buckets with their CORS and lifecycle rules (R2 storage past 10 GB is billed and has no hard cap, only the $1 budget alert in `knowledge/platform.md`, and no rule here can see how much is stored), and Zitadel objects. Adding a billing resource means editing `allowed.rego` in the same change, where a reviewer sees it, and adding its cap or alert row to `knowledge/platform.md`.

The rules have unit tests with failing examples (`conftest verify`), which CI also runs.

## Consequences

- A plan that deletes or replaces fails the check even when the owner agreed. That apply is then run by hand after the owner's yes, and the log names it.
- OPS-005 runs `policy.sh plan staging` before its staging apply, once CI has credentials.
- Budgets per environment and storage class rules stay in OPS-009.
- Developers need conftest (`brew install conftest`) only when they change `infra/tofu`.
