# Result: both slide buckets carry the tiering rule in R2, and the first live cost report shows $11.84 this month but files the EU bucket as unbudgeted

- Date: 2026-11-21
- Backlog: OPS-009 (storage lifecycle and cost controls)
- Kind: production measurement
- Commit: `13654aa8` (main at the time of the run)
- Environment: MacBook, OpenTofu through `infra/tofu/tofu.sh`, conftest through `infra/tofu/policy.sh`, the Cloudflare API with the token in `.env`, Modal CLI
- Data: no tenant data read

## Question

ADR 0341 (old tenant objects tier to Infrequent Access and budgets live in a cost report) owes a policy plan, an additive apply of dev and prod, a read back of the lifecycle rule in R2, and a first live run of `pnpm --filter @parfocal/deploy costs`.

## Method

1. `tofu.sh dev plan` and `tofu.sh prod plan`, then `policy.sh plan dev` and `policy.sh plan prod`.
2. Applied the saved prod plan. Dev had nothing to apply.
3. Read each bucket's rules back with `GET /accounts/{account}/r2/buckets/{bucket}/lifecycle` and its jurisdiction header.
4. Ran `uv run --package parfocal-deploy python -m parfocal_deploy.costs` with `.env` loaded, and read the bucket names and Modal environments it saw.

## Results

| Root | Plan | Conftest |
|---|---|---|
| dev | No changes | 2 tests, 2 passed |
| prod | 0 to add, 0 to change, 0 to destroy, four resources moved to an index `[0]` | 2 tests, 2 passed |

The prod apply changed only state. A plan straight after it said No changes.

| Bucket | Jurisdiction | Rules read back |
|---|---|---|
| `parfocal-dev-eu` | eu | `abort-incomplete-uploads` under `t/` after 86,400 s, `tier-old-tenant-objects` under `t/` to InfrequentAccess after 7,776,000 s (90 days) |
| `parfocal-prod` | default | the same two rules |
| `parfocal-dev` | default | the lifecycle call answered 404. Whether the bucket still exists was not checked, and the analytics still list it with 0.0 GB |

The cost report for 2026-11, read on 2026-11-21, exited 1.

| Environment | Service | Spend | Budget | Status |
|---|---|---|---|---|
| dev | Modal | $0.83 | $3.00 | ok |
| drill | Cloudflare R2 | $0.00 | $0.50 | ok |
| drill | Modal | $0.00 | $2.00 | ok |
| preview | Modal | $0.00 | $1.50 | ok |
| production | Cloudflare R2 | $0.00 | $3.00 | ok |
| production | Modal | $10.53 | $20.00 | ok |
| unbudgeted | Cloudflare R2 | $0.48 | $0.00 | over |
| unbudgeted | Modal | $0.00 | $0.00 | over |
| all | all | $11.84 | $30.00 | ok against the $30.00 cap |

Cloudflare's analytics name the EU bucket `eu_parfocal-dev-eu`, 41.79 GB, while `BUCKETS` in `costs.py` lists `parfocal-dev-eu`. So the bucket lands in unbudgeted and production R2 reads $0.00. The unbudgeted Modal line is the old `staging` environment, $0.0003, which ADR 0341 makes fail on purpose.

## Interpretation

- The lifecycle rules are live on both slide buckets and match the ADR.
- The drill's last step, the storage class of an object older than 90 days, cannot be checked before such an object exists.
- The cost report works against the live APIs, but its bucket map misses the jurisdiction prefix, so it fails every run.

## Follow-ups

- `TODO` map `eu_parfocal-dev-eu` to production in `costs.py`, or strip the jurisdiction prefix, with a test.
- `TODO` decide whether the `staging` Modal environment with $0.0003 should be removed, which is a delete for the owner.
- `TODO` after 90 days, check the storage class of an old object under a drill prefix.
