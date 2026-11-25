# Result: the cost report counted network egress that Modal's free allowance covers, and now reads $11.08 of the $30 Modal credit used, as the billing page does

- Date: 2026-11-25
- Backlog: OPS-043 (the live cost report matches Modal's billing page)
- Kind: production read and measurement
- Commit: `a4d78f26` plus the OPS-043 change to `workers/deploy/src/parfocal_deploy/costs.py`
- Environment: MacBook, Modal SDK 1.6.3 with the owner's workspace token, the Cloudflare API token in `.env`
- Data: Modal billing summaries and reports for November 2026, no tenant data

## Question

The live cost report of 2026-11-24 said $29.22 of the $30 November Modal credit was spent, $28.39 of it in production. Modal's billing page on 2026-11-25 showed $11.01 used and $18.99 left. Why did the report read so high, and does the fixed report match the billing page within a dollar?

## Method

1. Read November with the old reader, `modal.billing.workspace_billing_report(start=2026-11-01)`, and summed `cost` by day, by environment and by object, counting rows that share an object and a day.
2. Read `Workspace.billing.summary()` for November, which gives the metered cost, its breakdown by resource and the adjustments between metered and billed cost.
3. Read the report's `cost_by_resource` per row.
4. Changed `costs.py` so the all Modal line is the credit used from the summary (billed cost minus the `Credits` and `Plan Cost` adjustments) and each environment's line takes off the share of its network egress that the `Network Egress Allowance` covers. Whole days are read at daily resolution and today hourly, because Modal refuses hourly reports over 7 days.
5. Ran the fixed report once at 2026-11-25 19:56:49 UTC and saved that same Modal answer, summed per environment, as `workers/deploy/tests/fixtures/modal-usage-2026-11-25.json` for the unit test.
6. Read the daily report from 2026-11-01 to 2026-11-24 00:00 UTC again with its resources, to see what the 2026-11-24 run had counted.

## Results

The old reader had no duplicate rows and read the calendar month. November's summary at 19:56:49 UTC:

| Part | Amount |
|---|---|
| Metered cost | $30.26 |
| of which Network Egress | $19.18 |
| of which Deployed Apps | $10.81 |
| of which Ephemeral Apps | $0.27 |
| Network Egress Allowance | -$19.18 |
| Credits | -$11.08 |
| Billed cost | $0.00 |

The 2026-11-24 report summed daily rows up to 2026-11-24 00:00 UTC. Read again today:

| Environment | Report cost | Network Egress in it | Without egress |
|---|---|---|---|
| main (production) | $28.39 | $18.56 | $9.83 |
| dev | $0.83 | $0.57 | $0.26 |
| staging | $0.0003 | $0 | $0.0003 |
| all | $29.22 | $19.13 | $10.09 |

Fixed report for 2026-11, read 2026-11-25 19:56:49 UTC, exit 1:

| Environment | Service | Spend | Budget | Status |
|---|---|---|---|---|
| dev | Modal | $0.26 | $3.00 | ok |
| drill | Cloudflare R2 | $0.00 | $0.50 | ok |
| drill | Modal | $0.00 | $2.00 | ok |
| preview | Modal | $0.00 | $1.50 | ok |
| production | Cloudflare R2 | $0.48 | $3.00 | ok |
| production | Modal | $10.79 | $23.50 | ok |
| unbudgeted | Modal | $0.00 | $0.00 | over |
| all | Modal | $11.08 | $30.00 | ok against the $30.00 Modal credit |

The same answer summed the old way gives $30.24. The environment lines add up to $11.06, $0.02 under the all line, because Modal had not yet itemised the current hour.

| Source | Credit used | Read at |
|---|---|---|
| Modal's billing page, read by the owner | $11.01 | 2026-11-25, time not recorded |
| Fixed cost report | $11.08 | 2026-11-25 19:56:49 UTC |

## Interpretation

- The cause was network egress. Modal's report puts egress in each row's `cost`, but on the Starter plan a free egress allowance covers it before any credit is drawn, and this month it covered all $19.18. The old report counted it as spend, so it read about three times too high. It was not a rolling window, credits or a double count.
- The fixed report reads $11.08, $0.07 above the owner's $11.01 from earlier the same day, which is within a dollar. The difference fits the GPU and api work between the two reads, since the figure only grows during the day, but the owner's read time was not recorded, so that is an assumption.
- Production Modal is inside its $23.50 budget, at $10.79. The report still exits 1 only for the unbudgeted line, the deleted `staging` environment's $0.0003, which stays until December.
- The all line now comes from the billing summary and raises an error if Modal stops naming a `Credits` adjustment, so a renamed key cannot read as $0 used.

## Follow-ups

- The 2026-11-24 result carries a correction note pointing here.
- `TODO` the 2026-11-21 result (storage lifecycle and cost report) was read the same old way, so its Modal figures likely include covered egress too.
