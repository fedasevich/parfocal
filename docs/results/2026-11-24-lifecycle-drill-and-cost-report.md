# Result: a drill bucket carries a date tiering rule on t/ and the live cost report shows production Modal at $28.39 against a $23.50 budget

- Date: 2026-11-24
- Backlog: OPS-009 (storage lifecycle and cost controls)
- Kind: production drill and measurement
- Commit: `3167db5b` (main at the time of the run)
- Environment: MacBook, the Cloudflare API and Wrangler with the `CLOUDFLARE_API_TOKEN` in `.env`, Modal CLI, `uv run --package parfocal-deploy python -m parfocal_deploy.costs`
- Data: no tenant data. The drill objects hold one line of plain text, 48 bytes each

## Question

ADR 0341 (old tenant objects tier to Infrequent Access and budgets live in a cost report) owes a drill that shows the tiering rule move objects under `t/` and leave other prefixes alone, and a live run of the cost report now that the token reads account analytics.

## Method

1. Created the bucket `parfocal-drill-lifecycle` in the EU jurisdiction at 22:25:39 UTC. The cost report files every `parfocal-drill-` bucket under the drill budget.
2. Put two objects with Wrangler: `t/drill/tenant-object.txt` under the tiered prefix and `fixtures/drill/control-object.txt` outside it.
3. Added one rule, `drill-tier-tenant-objects-by-date`, with the same prefix `t/` and target class `InfrequentAccess` as the live `tier-old-tenant-objects`, but with a date condition of 2026-11-24 instead of 90 days, so it is due at once. Cloudflare says most objects move within 24 hours of a rule.
4. Read the rule and each object's storage class back through `GET /accounts/{account}/r2/buckets/{bucket}/lifecycle` and `.../objects`.
5. Ran the cost report at 22:24:12 UTC and again at 22:39:29 UTC.

## Results

Rule read back at 22:25:54 UTC:

```
{"id": "drill-tier-tenant-objects-by-date", "enabled": true, "conditions": {"prefix": "t/"},
 "storageClassTransitions": [{"condition": {"type": "Date", "date": "2026-11-24T00:00:00.000Z"},
 "storageClass": "InfrequentAccess"}]}
```

| Read at (UTC) | `t/drill/tenant-object.txt` | `fixtures/drill/control-object.txt` |
|---|---|---|
| 2026-11-24 22:25:54 | Standard | Standard |
| 2026-11-24 22:42:49 | Standard | Standard |

Cost report for 2026-11, read 2026-11-24 22:24:12 UTC, exit 1:

| Environment | Service | Spend | Budget | Status |
|---|---|---|---|---|
| dev | Modal | $0.83 | $3.00 | ok |
| drill | Cloudflare R2 | $0.00 | $0.50 | ok |
| drill | Modal | $0.00 | $2.00 | ok |
| preview | Modal | $0.00 | $1.50 | ok |
| production | Cloudflare R2 | $0.48 | $3.00 | ok |
| production | Modal | $28.39 | $23.50 | over |
| unbudgeted | Modal | $0.00 | $0.00 | over |
| all | Modal | $29.22 | $30.00 | ok against the $30.00 Modal credit |

A second run at 22:39:29 UTC, after a tumor map of about 12 minutes on the GPU pool, printed every line the same and exited 1, so Modal's billing report had not yet counted that GPU time.

## Interpretation

- The drill uses a date condition, so it can show that the rule touches only `t/` and moves objects to Infrequent Access, but not the 90-day age clock of the live rule.
- The drill is not finished. The rule is live on the drill bucket, but 17 minutes after it was set both objects were still Standard, inside the 24 hours Cloudflare names. The tiering is shown only when `t/drill/tenant-object.txt` reads `InfrequentAccess` and `fixtures/drill/control-object.txt` still reads Standard. `TODO` recheck from 2026-11-25 23:00 UTC with `GET /accounts/{account}/r2/buckets/parfocal-drill-lifecycle/objects` and the header `cf-r2-jurisdiction: eu`.

- The cost report now runs live end to end. The EU bucket lands under production since the jurisdiction prefix fix, so the unbudgeted R2 line of 2026-11-21 is gone.
- It exits 1 for two reasons. Production Modal is $4.89 over its $23.50 budget with six days of November left, and the whole Modal month is $0.78 under the $30.00 credit. The unbudgeted Modal line is the `staging` environment, deleted on 2026-11-22, whose $0.0003 this month ([result of 2026-11-21](2026-11-21-storage-lifecycle-and-cost-report.md)) still shows in Modal's billing report, so it fails until December.

## Follow-ups

- `TODO` the owner decides whether production Modal gets a larger budget or work stops until December, because the month is near the $30 credit.
- `TODO` the drill bucket `parfocal-drill-lifecycle` with its two objects should be deleted after the drill. Deleting is an owner action.
