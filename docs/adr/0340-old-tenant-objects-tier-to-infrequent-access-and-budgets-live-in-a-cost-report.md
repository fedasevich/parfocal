# 0340. Old tenant objects move to Infrequent Access after 90 days, and budgets per environment live in a cost report

- Date: 2026-11-15
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: OPS-009 (storage lifecycle and cost controls). Builds on [ADR 0115](0115-production-access-and-spend-caps.md) (production access and spend caps), [ADR 0288](0288-conftest-checks-the-opentofu-code-and-every-plan.md) (conftest checks the OpenTofu code) and [ADR 0331](0331-no-staging-environment.md) (no staging environment)

## Context

OPS-009 asks for tiering of old slides, GPU scale to zero, budgets per environment and cost dashboards. R2 lifecycle rules match a literal key prefix and an age since upload, not the last read. Tenant keys are `t/{tenant}/s/...` for slides, `t/{tenant}/quarantine/...` for uploads and `t/{tenant}/exports/...` for patch exports, so no rule can pick only slides. R2 Infrequent Access costs $0.01 per GB a month against $0.015 for Standard, but charges $0.01 per GB read, $0.90 instead of $0.36 per million reads, bills at least 30 days, has no free tier, and a lifecycle rule cannot move an object back. The account already holds about 26 GB under `parfocal-dev/fixtures/`, past the free 10 GB, and tests read those fixtures all the time. Cloudflare budget alerts are account-wide and the provider has no budget resource, and Modal and Neon have no OpenTofu provider here.

## Options considered

1. No tiering. Simplest, and storage of the pilot's slides stays at Standard prices.
2. Tier everything under `t/` after an age, through the existing lifecycle resource of each slide bucket, and keep `fixtures/` out.
3. Tier with an empty prefix. Cheapest storage, but the fixtures that tests read would pay retrieval on every run.
4. For budgets, Cloudflare notification policies of type `billing_usage_alert` in OpenTofu. The product values for that filter are not documented where we could read them, `tofu validate` cannot catch a wrong one, and they are account-wide anyway.
5. For budgets, a cost report in code that reads Modal's billing report by environment and R2 bucket sizes, and compares them with a budget table per environment.

## Decision

Options 2 and 5.

- The environment module's lifecycle resource keeps its upload rule and gains `tier-old-tenant-objects`, which moves objects under `t/` to Infrequent Access after `tier_after_days`, 90 by default. The variable refuses less than 30 days. Slides, quarantined uploads and exports older than 90 days all move. A viewer opening an old slide reads a few hundred MB at most, about $0.003.
- Conftest refuses any lifecycle rule that deletes objects, any prefix other than `t/`, any storage class but Infrequent Access, a literal age under 30 days, and a module without the tiering rule.
- `pnpm --filter @parfocal/deploy costs` writes the cost dashboard, a Markdown table of spend against budget for each environment and service, and exits 1 when a line is over budget. Budgets are production $20 Modal and $3 R2, dev $3 Modal, and the drill environment $2 Modal and $0.50 R2, $28.50 in all, inside the $30 a month of [ADR 0151](0151-standing-approval-for-production-within-30-dollars.md) (standing approval within $30 a month). Spend in an environment with no budget, such as the old Modal `staging`, always fails.
- GPU scale to zero is already enforced by `workers/ml/src/parfocal_ml/gpu_pool.py`, which refuses a pool with `min_containers` or buffer containers above zero, and the API and ingest functions in `workers/deploy` set `min_containers` to 0.

## Consequences

- Applying the rule is an additive production write under ADR 0151, owed by whoever holds the credentials, after `policy.sh plan prod` and `policy.sh plan dev`.
- The lifecycle rule can only be proved in R2. The drill is: apply, read the rule back with `wrangler r2 bucket lifecycle list`, and after 90 days check the storage class of an old object under a drill prefix. The local MinIO has no Infrequent Access class.
- R2 cost in the report is priced as Standard storage, an upper bound once objects tier. Neon, Workers, Zitadel and Resend stay out of the report because their plans cap them at $0.
- Changing the key layout so that only slides tier would need a new prefix scheme and a migration.
