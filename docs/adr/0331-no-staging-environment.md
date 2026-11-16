# 0331. There is no staging environment, now or later

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: OPS-014 (prepare production for the first real user), which replaces "bring back staging before the first real user". Changes OPS-003 (environments), OPS-005 (continuous deployment), OPS-007 (alerting and on-call), OPS-008 (backups and disaster recovery), OPS-009 (storage lifecycle and cost controls), OPS-010 (tenant provisioning automation), OPS-011 (status page and maintenance mode), SEC-013 (secrets management in all environments) and the pilot runbook tasks.

## Context

[ADR 0293](0293-production-only-until-the-first-real-user.md) (production only until the first real user) made production the only cloud environment and kept a firm trigger that brought staging back before the first real user. Parfocal is the practical part of a master's thesis that runs on $30 a month. A second cloud environment means a second set of deploy credentials, a Neon branch, a bucket, a login app, a hostname and a Modal environment to keep in step, for a pilot of a few users.

## Options considered

1. Keep the trigger of ADR 0293 and bring staging back before the first real user.
2. No staging ever. Local development and production only, and what staging guarded is done in production before the first real user.

## Decision

Option 2, on the owner's word of 2026-11-15 ("drop staging for good, it is unnecessary complexity for a thesis project").

- The environments are local development and production at `https://app.parfocal.eu`, now and later. Previews per pull request (OPS-003) stay planned.
- OPS-014 becomes "prepare production for the first real user": production's slides move to `parfocal-prod`, the E2E account and all fixture and test data leave production, production deploys only from a tag with approval, the standing yes to reset production ends, and the unused `staging` OpenTofu root is removed. No account is made for a real user until it is ticked.
- Checks that were "on staging" run in local development when they can. Checks that need the cloud and destroy things, such as a restore drill, fault injection, lifecycle rules or tenant deprovisioning, run in a drill environment: a short-lived Neon branch of production, a separate Modal environment and a prefix in the slide bucket, made for the check and deleted after it, with its cost logged.
- Everything else in ADR 0293 stands until OPS-014 is ticked, including the standing yes to reset and reseed production while it holds only the owner's test data.

## Consequences

- One environment to deploy, pay for and keep in step, at the cost that every deploy reaches the only cloud environment. Migration checks, rollback by redeploy ([ADR 0297](0297-main-deploys-to-production-behind-a-switch-with-a-migration-check-and-rollback-by-redeploy.md)) and tagged releases after OPS-014 carry that risk.
- Removing the `staging` root and anything it still manages in the cloud is a destructive action and is asked in chat first, as [ADR 0151](0151-standing-approval-for-production-within-30-dollars.md) says.
- Amends ADR 0293, whose staging trigger ends here.
