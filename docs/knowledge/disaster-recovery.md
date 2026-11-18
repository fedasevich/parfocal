# Backups and disaster recovery

What can be restored, how far back, and the steps. Owner: OPS-008 (backups and disaster recovery). Numbers marked "measured" come from [the Neon point-in-time drill](../results/2026-11-18-neon-pitr-drill.md).

## Objectives

These are proposed, not yet confirmed by the owner (decision 152 in `docs/decisions.md`).

| Part | Recovery point | Recovery time | Where it comes from |
| --- | --- | --- | --- |
| Postgres, last 6 hours | seconds | 1 hour proposed, a point-in-time branch was usable in 1.5 s at 47 MiB (measured) | Neon history on the Free plan |
| Postgres, older than 6 hours | up to the age of the last logical dump | 1 hour proposed, not yet measured for a dump restore | the monthly restore check dump, once it keeps a copy (decision 152) |
| Tenant objects under `t/` in R2 | 7 days of lock against delete and overwrite | minutes, not yet drilled | bucket lock `keep-tenant-objects` from SEC-014 |

## Restore Postgres from Neon history

1. Pick the timestamp just before the damage. It must be inside the 6 hour history window, so act fast.
2. Create a branch from it, never restore over `main`:
   `npx neonctl branches create --name drill-<date> --parent <timestamp> --expires-at <date> --project-id still-field-25034761 --org-id org-blue-credit-47472368`
3. Check it with `parfocal_deploy.restore_check.fingerprint` against the source, and read `alembic_version`.
4. Pointing the Modal secret `parfocal-api-database-eu` and the edge at the branch, or resetting `main` from it, replaces production data. That is the owner's step, because an agent is refused it by the guard and ADR 0115 (production access and spend caps).
5. Log the run in `docs/log.md`.

## Drill

Run the steps above with a branch that expires the same day, then check row counts and content digests. Agents may create the branch. They cannot delete it, so always pass `--expires-at`.

## Not covered yet

- A copy of the data outside Neon and outside the same region. Residency rules keep personal data in the EU, so the copy must be an EU bucket (decision 152).
- A drill that restores the logical dump.
- The R2 object recovery drill.
