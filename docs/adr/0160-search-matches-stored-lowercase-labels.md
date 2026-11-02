# 0160. Search matches stored lowercase copies of labels with LIKE instead of ILIKE

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas (owner standing approval, ADR 0151)
- Backlog: CASES-009 (search API). Refines ADR 0094 (search on Postgres under row-level security)

## Context

ADR 0094 matched project, case and slide labels with `ILIKE`. On 100,000 seeded cases the latency test missed its 100 ms p95 even on the owner's Mac. `ILIKE` and `LIKE` are not leakproof in Postgres, so under row-level security the planner cannot use an index for them, and `ILIKE` cost about three times `LIKE` in the scan.

## Options considered

| Option | For | Against |
|---|---|---|
| Keep `ILIKE` and raise the budget | No schema change | Breaks the STACK-034 budget |
| Stored lowercase copies matched with `LIKE` | p95 falls to about 25 ms, matching stays case-insensitive | Three extra columns kept in step by the database |

## Decision

Migration 0077 adds stored generated lowercase copies of the labels, and search lowercases the pattern and matches with `LIKE`, with the same escaping. Numbers are in [the result file](../results/2026-11-03-search-latency-lower-labels.md).

## Consequences

The rest of ADR 0094 stands. If the table grows past the budget again, the result file lists the next steps.
