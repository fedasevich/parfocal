# Tenant provisioning runbook

How to provision and deprovision a tenant with one command each. The logic is OPS-010 (tenant provisioning automation) in `apps/api/src/parfocal_api/tenant_provisioning.py`, and OPS-019 added the Zitadel adapter (`zitadel_directory.py`) and the command (`tenant_command.py`).

## What the command does

- `provision` finds or creates the organisation row, creates the tenant, seeds the built-in study templates, makes the tenant's data keys, writes the audit events, makes sure the bucket exists and finds or creates the Zitadel organisation `parfocal-<slug>`. It prints the tenant id.
- `deprovision TENANT_ID` suspends the tenant, deletes the Zitadel organisation `parfocal-<slug>` with its users, deletes every object under `t/<tenant id>/`, shreds the tenant's data keys and writes `tenant.deprovisioned`. It prints what it removed. A second run removes nothing and still succeeds. Shredding the keys cannot be undone, so the tenant's encrypted identifiers are gone for good.
- The command reads `DATABASE_URL`, `MASTER_KEYS`, `ZITADEL_ISSUER`, `ZITADEL_ADMIN_TOKEN` and the `STORAGE_*` settings from the environment. `ZITADEL_ADMIN_TOKEN` belongs to the command only, never to the running API, because it can delete any organisation.
- A Zitadel or unknown-tenant error exits with status 1 and never prints the token.

## Local run

`make dev` or `bash infra/local/zitadel-up.sh` writes `.zitadel/e2e.env` with the local issuer and its admin token.

```
set -a; . ./.env; . .zitadel/e2e.env; set +a
uv run --package parfocal-api python -m parfocal_api.tenant_command provision \
  --organisation-slug lab --organisation-name "Lab" --slug lab-research --name "Lab research" --kind research
uv run --package parfocal-api python -m parfocal_api.tenant_command deprovision <tenant id>
```

`apps/api/tests/test_tenant_command.py` runs both directions through the command against the local Zitadel, a migrated scratch database and MinIO, and checks the organisation with its own Zitadel call. It skips without `.zitadel/e2e.env` and refuses an issuer that is not `localhost`. Run it with `uv run --package parfocal-api pytest apps/api/tests/test_tenant_command.py -m "db or not db"`. It passed on 2026-11-16.

## Drill environment run

Deprovisioning destroys data, so its cloud check runs in a drill environment as [ADR 0331](../adr/0331-no-staging-environment.md) (no staging environment) describes: a short-lived Neon branch of production, a separate Modal environment and a prefix in the slide bucket, made for the check and deleted after it, with its cost logged.

1. Make the Neon branch and point `DATABASE_URL` at it.
2. Point the `STORAGE_*` settings at the drill prefix or a drill bucket, never at a tenant's real objects.
3. Set `ZITADEL_ISSUER` and `ZITADEL_ADMIN_TOKEN` for the Zitadel the drill uses. The production instance has no such token yet, and making one is the owner's choice.
4. Provision a tenant named `drill-<date>`, then deprovision it, and check that the organisation, the objects and the keys are gone.
5. Delete the branch, the prefix and the token, and log the run and its cost in `docs/log.md`.

TODO: the drill environment run has not happened yet. It waits for the owner's choice of a Zitadel token for the drill.
