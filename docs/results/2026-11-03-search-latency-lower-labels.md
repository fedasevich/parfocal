# Search latency with stored lower-cased labels

- Date: 2026-11-03
- Task: CASES-009 (search API)
- Machine: an agent worktree on an Apple Silicon Mac with the Docker Compose Postgres 17.10 and pooler, not the owner's reference machine. Another agent ran tests at the same time, so absolute numbers are noisy.

## Question

Why does the latency test (`test_search_meets_the_latency_budget_on_100_000_cases`, 20 case searches on 100,000 seeded cases, p95 under 100 ms from STACK-034, the search spike) miss its budget on the owner's Mac, and what brings it under?

## Where the time went

- The case query is a full scan. `EXPLAIN (ANALYZE, BUFFERS)` as `parfocal_app` shows a parallel sequential scan of all 100,000 rows with the tenant policy, the `ILIKE` and the readable-project filter applied per row, 22 ms of execution for `'%000101%'`.
- No index can help under row-level security, because `~~*` and `~~` are not leakproof in Postgres 17, so the planner may not use them as index conditions ahead of the tenant policy. This confirms [ADR 0094](../adr/0094-search-on-postgres.md) (search on Postgres under row-level security).
- `ILIKE` itself is the cost. On the same plan, counting matches took 55 ms with `label ILIKE '%000101%'` and 18 ms with `label LIKE '%000101%'`, against 18 ms for the scan alone. Case-insensitive matching folds every character of every row.
- Per-request overhead is small. A people search, which reads a few rows, answered in 2 to 5 ms through the full API stack.
- The first request after seeding takes 160 to 220 ms, before and after the change. The test's p95 is the 19th of 20 sorted samples, so it tolerates this one warm-up outlier.

## Change

Migration `0077` adds stored generated columns `projects.name_lower`, `cases.label_lower` and `slides.label_lower` holding `lower(...)` of the label. Search matches `column_lower LIKE lower(pattern)`, which keeps case-insensitive matching with the same folding on both sides and the same escaping of `%`, `_` and `\`. Ordering still uses the original label.

## Results

Latency test, three runs each, milliseconds.

| | Median | p95 (19th of 20) | Slowest |
|---|---|---|---|
| Before, run 1 | 46.2 | 57.7 | 204.8 |
| Before, run 2 | 46.0 | 48.5 | 224.9 |
| Before, run 3 | 27.0 | 58.7 | 197.0 |
| After, run 1 | 21.1 | 24.0 | 197.4 |
| After, run 2 | 23.0 | 24.7 | 178.3 |
| After, run 3 | 22.2 | 23.8 | 159.7 |

The p95 fell by about 2.3 times. If the owner's Mac was twice as slow as this one (single requests of 56 to 84 ms before), the same factor predicts a p95 of about 35 to 50 ms there. TODO: confirm on the reference machine.

## Options if the budget is missed again

The scan still grows linearly with the table. The next steps, in order of cost, are those in ADR 0094 option 2 (a search path that can use an index): a side table of label suffixes matched with the leakproof prefix operator `^@` under the same tenant policy, or a security-definer function that returns candidate IDs which the outer query still filters under row-level security. Both need an ADR.
