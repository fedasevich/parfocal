# Result: Postgres search over 100,000 cases answers in under 30 ms, and row-level security keeps it off the trigram index

- Date: 2026-10-18
- Backlog: STACK-034 (search)
- Kind: spike
- Commit: 47feada
- Environment: MacBook (Apple silicon, arm64), macOS 15.8.1, the local Docker stack: PostgreSQL 17.10 with PostGIS (`imresamu/postgis:17-3.6.1-alpine3.22`) behind PgBouncer 1.26, queries from Python 3.14 through SQLAlchemy and asyncpg as the app role, inside a tenant scope with row-level security on
- Data: synthetic only. Three workspaces with 20 projects each, 100,000 cases in the measured workspace and 10,000 in each of the other two (120,000 cases), two slides per case (240,000 slides), and 100,000 patients in one clinical project with two random blind tokens each. Labels look like `S26-04812-Kaloravi-17`, with name-like words built from twelve syllables

## Question

Can plain Postgres return cases, slides and patients for part of a name in under 100 ms on 100,000 cases, as STACK-034 asks, with row-level security covering search?

## Method

A throwaway script (not committed) migrates a fresh database, seeds the data above with SQL, runs `ANALYZE`, and times 200 queries per row of the table in a new transaction each, as the app role through PgBouncer with the tenant scope set. Case and slide queries are `label ILIKE '%<probe>%' ORDER BY label LIMIT 20`. The probes are four letters cut from random case labels' words (matching hundreds of cases each) or a case's five-digit number (matching a few). Patient queries match one whole-word blind token with `name_tokens @> ARRAY[...]` on the existing GIN index, the way `identifiers.find_patients` does. GIN trigram indexes on `cases.label` and `slides.label` are added halfway, then the plan is read with `EXPLAIN ANALYZE` inside the tenant scope.

## Results

| Query | Runs | p50 ms | p95 ms | max ms | Median rows |
|---|---|---|---|---|---|
| Cases, four letters, no trigram index | 200 | 26.9 | 28.4 | 29.6 | 20 |
| Cases, four letters, trigram index | 200 | 26.6 | 27.4 | 29.0 | 20 |
| Slides, four letters, trigram index | 200 | 37.2 | 38.4 | 44.6 | 20 |
| Cases, five-digit number, trigram index | 200 | 26.9 | 28.2 | 29.7 | 3 |
| Patients, one whole-word token | 200 | 9.8 | 10.6 | 12.7 | 1 |

Inside the tenant scope the plan is a parallel sequential scan of `cases` with the policy and the `ILIKE` as one filter (26.5 ms executed). As the table owner without the scope, the same query uses a bitmap scan on the trigram index.

## Interpretation

- Every query is well under the 100 ms budget at this size, including the time through PgBouncer.
- The trigram index is not used under row-level security. `ILIKE` is not a leakproof operator, so Postgres must apply the policy before it, and the scan reads every case of the table. Time therefore grows with the table: as an assumption from these numbers, about 0.25 ms per 1,000 rows, so the budget would be passed somewhere above 300,000 cases in one table.
- Patients are found only by whole words, because their names are sealed and indexed as blind tokens ([ADR 0034](../adr/0034-blind-indexes-for-encrypted-patient-identifiers.md)). A partial patient name cannot be searched by design.
- There are no stored reports yet, so report search was not measured.

## Follow-ups

- [ADR 0094](../adr/0094-search-on-postgres.md) records the decision and the trigger that reopens it.
- TODO: repeat on Neon with production-sized data when cloud work resumes.
