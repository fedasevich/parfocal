# 0293. Production is the only cloud environment until the first real user, and the owner's test data there may be reset

- Date: 2026-11-13
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: OPS-014 (bring back staging before the first real user), added here. Changes SKEL-001 (production environment exists), SKEL-002 (log in through the IdP), SKEL-009 (CI deploys main to production), SKEL-011 (skeleton numbers from production and hosted runners), OPS-003 (environments), OPS-005 (continuous deployment), OPS-006 (observability stack), FOUND-035 (squash the migrations into one baseline) and SEC-011 (security headers and CSP). OPS-002 (deploy definitions) targets production too and is edited by its own agent.

## Context

Decision 81a (staging before more features) of 2026-11-13 put a staging environment ahead of every other task. The same day the owner looked at what it costs to stand up two cloud environments, each with its own deploy credentials, Neon branch, bucket, login app and hostname, while the owner is the only user and no real data exists anywhere. Staging protects real users' data from untested changes. With no real users, it protects nothing and doubles the setup work.

[ADR 0151](0151-standing-approval-for-production-within-30-dollars.md) (standing approval within $30 a month) asks the owner before every destructive production action. A production that is also the place where the skeleton is tried needs its database reset and reseeded often, which would bring back a question per run.

## Options considered

1. Staging first, production later (decision 81a). Safe for real data that does not exist yet, at twice the setup.
2. Staging only, no production. The same single environment under another name, and the real hostname, the real login app and the release path stay unproven.
3. Production only until the first real user, with a written trigger that brings staging back. One setup, the real path is proven early, and the wall returns before it is needed.

## Decision

Option 3, on the owner's terms of 2026-11-13.

- The environments are local development and production at `https://app.parfocal.eu`. Nothing is deployed to staging. Previews per pull request (OPS-003, environments) stay planned and no longer borrow anything from staging.
- The trigger is written and firm. Staging returns before the first real user's data enters production, where the first real user is the first pilot user other than the owner. OPS-014 (bring back staging before the first real user) is that work, and no account is made for such a user until it is ticked.
- Until the trigger, the owner gives a standing yes to reset and reseed production while it holds only the owner's test data. This covers dropping and recreating the application database or its Neon branch, running the seed again, and emptying the app's own tenant prefix `t/` in the slide bucket. It counts for every session and subagent, it ends at the trigger without a further word, and each reset is logged in `docs/log.md`.
- Everything else on the "still asked" list of ADR 0151 stays asked in chat, one action at a time, as that record and [ADR 0115](0115-production-access-and-spend-caps.md) (production access and spend caps) say: deleting a bucket, a Neon project, a DNS record, a login app or a GitHub environment, rotating a secret, a `tofu apply` that destroys or replaces, and anything that raises spend. The fixture slides under `fixtures/` are not test data of the app and are never part of a reset.
- Until the trigger the deployed app keeps its slides in the existing R2 bucket `parfocal-dev`, which holds about 26 GB of fixture slides the owner uploaded, and shares it with local development. The empty bucket `parfocal-prod` stays unused. The owner had `parfocal-staging` deleted on 2026-11-13 (decision 92b), and the `staging` root makes it again when staging returns. When staging returns, production gets its own bucket again.
- Zitadel stays one organisation, `Parfocal`. [ADR 0292](0292-staging-and-production-identity-in-separate-organisations.md) (staging and production identity in separate Zitadel organisations) is rejected. None of its migration steps had run.
- This record amends ADR 0151, which gains the reseed yes above, and [ADR 0287](0287-one-opentofu-root-per-environment-over-a-shared-module.md) (one OpenTofu root per environment). The `staging` root, its state file `staging.tfstate` and what it manages stay in the repository and in the cloud, unused. No infrastructure code is deleted, so staging can come back cheaply. The root is not applied again until OPS-014.

## Consequences

- `main` deploys to production. [ADR 0050](0050-deploy-pipeline-and-previews.md) (deploy pipeline and previews) had `main` going to staging and tags to production with approval, and previews using the staging Wrangler block. OPS-005 (continuous deployment) and OPS-003 (environments) now say what replaces that until the trigger, and the tagged release with approval returns with staging.
- The CI deploy secrets live in the GitHub environment `production` (decision 88, credentials that the production deploy needs). Deleting the GitHub environment `staging` and its tokens is decision 91.
- The E2E account `e2e-pathologist@parfocal.eu`, with a shared password and no second factor, stays a valid account in production's user directory. That is accepted only while the owner is the only user, and OPS-014 has to remove it from production or wall it off.
- Local development and the deployed app write under the same bucket. Since 2026-11-13 the upload CORS rule of `parfocal-dev` allows `https://app.parfocal.eu` next to `http://localhost:5173`, set by `extra_upload_origins` in the `dev` OpenTofu root. Local runs use MinIO and the bucket `parfocal-local` by default, so only checks that use the `R2_*` settings reach the deployed objects, as [knowledge/deploy.md](../knowledge/deploy.md) says.
- Tasks whose test is destructive keep their "on staging" wording and wait for OPS-014: the restore drill of OPS-008 (backups and disaster recovery), fault injection in OPS-007 (alerting and on-call), lifecycle rules in OPS-009 (storage lifecycle and cost controls), tenant deprovisioning in OPS-010 (tenant provisioning automation), maintenance mode in OPS-011 (status page and maintenance mode), secret rotation in SEC-013 (secrets management in all environments) and the later pilot rehearsals. All of them come after the first real user is in sight.
- A mistake in a deploy now reaches the only environment. That is cheap today and is the reason the trigger is firm.
