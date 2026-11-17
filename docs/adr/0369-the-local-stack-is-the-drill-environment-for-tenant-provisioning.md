# 0369. The local stack is the drill environment for tenant provisioning

- Date: 2026-11-17
- Status: Accepted
- Deciders: claude (OPS-010 parallel run)
- Backlog: OPS-010 (tenant provisioning automation). Amends ADR 0331 (no staging environment) for this task only.

## Context

OPS-010 (tenant provisioning automation) is done when a test provisions and deprovisions a tenant in a drill environment. [ADR 0331](0331-no-staging-environment.md) (no staging environment) defines that environment as a short-lived Neon branch of production, a separate Modal environment and a prefix in the slide bucket, made for a check and deleted after it. Running it in the cloud needs a Zitadel admin token for the drill, and production's Zitadel has none. Making one is the owner's choice, so the cloud drill has waited since 2026-11-15.

The local stack of [ADR 0368](0368-the-end-to-end-suite-runs-the-api-and-ingest-containers.md) (the end-to-end suite runs the API and ingest containers) runs a real Zitadel set up by `infra/tofu/idp-local`, Postgres with the production migrations and MinIO, all on `localhost`.

## Options considered

1. Wait for the owner to make a drill token for production's Zitadel and run the cloud drill that ADR 0331 (no staging environment) describes.
2. Count the local stack as the drill environment for tenant provisioning and keep the cloud drill as a later check.

## Decision

Option 2. `apps/api/tests/test_tenant_drill.py` is the drill. It runs only with `PARFOCAL_DRILL=1`, so CI and plain test runs skip it, and with the flag set it fails instead of skipping when the local Zitadel is missing. It refuses any database, storage or Zitadel address that is not `localhost` or `127.0.0.1`. It runs `python -m parfocal_api.tenant_command` on the host as a subprocess with an environment it builds itself, so nothing from `.env` reaches it. It uses the stack's Zitadel, Postgres and MinIO, not the API container. It provisions a tenant into a scratch migrated database, puts objects under the tenant's prefix, deprovisions it and checks that the Zitadel organisation, the objects and the data keys are gone and the tenant is suspended with its `tenant.deprovisioned` event. The scratch database is dropped and the organisation is removed in a `finally` even when an assertion fails.

## Consequences

- Tenant provisioning closes without a production token and without cloud cost.
- The drill does not prove Neon, R2, the hosted Zitadel or the command inside the deploy image. TLS to the database and to Zitadel, R2's listing and delete behaviour and the production organisation layout stay unchecked until the cloud drill runs.
- The cloud drill steps stay in [knowledge/tenant-provisioning.md](../knowledge/tenant-provisioning.md) for the day a drill token exists.

## Reopen when

- The owner makes a Zitadel token for drills, which makes the cloud drill of ADR 0331 (no staging environment) cheap enough to run.
- The first real tenant is provisioned in production, which should be preceded by one cloud drill.
