# Result: annotation reads during bulk inserts with the API in its own server

- Date: 2026-11-16
- Backlog: OPS-004 (database operations)
- Kind: load test
- Commit: the OPS-004 commit on top of `a973dd6e`
- Environment: Apple M4 with ten cores, macOS 15, Python 3.14, Postgres 17 with PostGIS and PgBouncer from `compose.yaml`. The API now runs in its own uvicorn process on 127.0.0.1, spawned by the test, and the client talks to it over loopback. The Mac was shared with three other agents, so every run lists its load average
- Data: synthetic 16-point cells of radius 6 px on a 20 px grid on one slide with one class, as in the [2026-11-15 run](2026-11-15-annotation-load-test.md) (reads sat on the 250 ms target with the API in process)

## Question

With the client no longer sharing the API's event loop, do annotation reads stay under the [ADR 0003](../adr/0003-pilot-platform-architecture.md) (pilot platform architecture) target of 250 ms at p95 while bulk inserts run? Does cheaper response serialisation help? Does autovacuum fire on the annotation tables with the migration 0122 (annotation autovacuum) settings in a run of a few minutes?

## Method

`apps/api/tests/test_annotation_load.py` starts `create_app` under uvicorn in a spawned process with the owner's principal as the auth override, waits for `/api/health`, then runs the same load as before: 10,000 seeded cells, two writers posting four bulk batches of 2,500 cells each, six readers looping on a 400 by 400 px `bbox` listing and one read by id. Run with `uv run pytest -m db apps/api/tests/test_annotation_load.py -s -q -k p95`.

A new opt-in test runs a mixed load for `PARFOCAL_LONG_LOAD_S` seconds: one writer posts 1,000 cells every 4 s, one editor changes a seeded cell's class every 50 ms, two readers list a viewport every 100 ms, and `pg_stat_user_tables` is sampled every 10 s. Run with `PARFOCAL_LONG_LOAD_S=150 uv run pytest -m db apps/api/tests/test_annotation_load.py -s -q -k long`. Without the variable it skips, so verify and CI never run it.

Two probes ran outside the test from scratch scripts against the same harness: six readers for 7 s on 30,000 rows with no writers, and a bbox listing alone, with `EXPLAIN (ANALYZE, BUFFERS)` of its query.

## Results

Short load, API in its own server, committed code:

| Run | Load avg (1, 5, 15 min) | Reads | Read p50 (ms) | Read p95 (ms) | Read max (ms) | bbox p95 (ms) | By id p95 (ms) | Batch p50 (ms) | Batch max (ms) | Wall (s) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3.75, 11.00, 22.71 | 318 | 45.8 | 127.3 | 194.4 | 129.0 | 59.1 | 610.6 | 772.5 | 7.2 |
| 2 | 4.19, 10.63, 22.30 | 324 | 46.2 | 134.7 | 189.1 | 138.5 | 51.7 | 638.4 | 823.0 | 7.3 |
| 3 | 3.93, 10.36, 22.07 | 322 | 40.5 | 126.1 | 199.3 | 131.9 | 52.5 | 590.0 | 793.0 | 7.1 |
| 4 | 4.16, 10.09, 21.77 | 316 | 44.2 | 127.4 | 183.3 | 137.0 | 53.0 | 609.4 | 799.4 | 7.2 |
| 5 | 5.28, 5.26, 10.58 | 310 | 47.5 | 143.2 | 212.0 | 149.4 | 55.9 | 707.2 | 926.7 | 7.5 |
| 6 | 5.08, 5.22, 10.50 | 314 | 51.9 | 145.7 | 203.4 | 149.9 | 105.4 | 700.2 | 837.6 | 7.4 |
| 7 | 4.90, 5.18, 10.40 | 318 | 48.7 | 137.8 | 198.0 | 143.5 | 57.4 | 628.6 | 819.6 | 7.2 |

Every request returned 200 or 201, and the slide held 30,000 rows after each run. The median read p95 is 134.7 ms, against 254 ms with the API in process.

Trial of cheaper serialisation, reverted: the bbox listing and the bulk response returned bytes from a Pydantic `TypeAdapter.dump_json`, with the declared response models kept so the OpenAPI schema did not change. Offline, that cut building a 400-shape listing from 20.1 ms to 1.2 ms. In the app it made no difference.

| Run | Load avg (1 min) | Reads | Read p95 (ms) | bbox p95 (ms) | By id p95 (ms) |
|---|---:|---:|---:|---:|---:|
| A1 | 4.92 | 310 | 146.4 | 154.9 | 55.8 |
| A2 | 4.87 | 332 | 145.9 | 151.1 | 57.0 |
| A3 | 5.05 | 318 | 137.5 | 150.2 | 59.5 |
| A4 | 5.33 | 332 | 129.5 | 134.0 | 46.3 |

A bbox listing alone, six calls on 30,000 rows, took 22.1, 79.5, 18.9, 17.4, 16.0 and 17.1 ms before the trial, and 27.8, 89.7, 23.9, 24.5, 22.7 and 27.4 ms with it. Both return the same number of bytes. Its query uses a bitmap scan of the GiST index `ix_annotations_geometry`, which returns 441 rows in 0.73 ms of execution and 5.5 ms of planning.

Readers only, no writers, 30,000 rows, load average 4.42: 968 reads, p50 50.4 ms, p95 126.1 ms, bbox p95 134.0 ms, by id p95 20.3 ms.

Long mixed load of 150 s, load average 3.81 before and 4.12 after: 2,196 reads with p50 28.1 ms and p95 84.9 ms, 36 batches of 1,000 with p50 168.5 ms. The server runs the defaults `autovacuum_naptime` 60 s, `autovacuum_vacuum_threshold` 50, `autovacuum_vacuum_insert_threshold` 1000 and `autovacuum_analyze_threshold` 50. Samples of `annotations`:

| t (s) | Live | Dead | Inserted since vacuum | Changed since analyze | Autovacuums | Autoanalyzes |
|---:|---:|---:|---:|---:|---:|---:|
| 0 | 10,000 | 0 | 10,000 | 10,000 | 0 | 0 |
| 10 | 13,000 | 12 | 2,000 | 2,094 | 1 | 1 |
| 20 | 16,000 | 22 | 2,000 | 2,098 | 2 | 2 |
| 50 | 23,000 | 67 | 9,000 | 9,558 | 2 | 2 |
| 60 | 25,000 | 4 | 1,000 | 1,019 | 3 | 3 |
| 110 | 37,000 | 62 | 13,000 | 13,760 | 3 | 3 |
| 120 | 39,000 | 8 | 0 | 23 | 4 | 4 |
| 150 | 46,000 | 49 | 7,000 | 7,437 | 4 | 4 |

`annotation_versions` followed the same steps, with four autovacuums and four autoanalyzes and no dead rows in any sample.

## Interpretation

- With the API in its own server, the read p95 is 126 to 146 ms in seven runs, so reads stay under the 250 ms target with about 100 ms to spare. The OPS-004 "Done when" line is met on this machine. The budget limit is now 250 ms with a baseline of 135 ms.
- Most of the 2026-11-15 latency came from the client sharing the API's loop and CPU, as that result suspected.
- Six readers with no writers already reach 126 ms at p95. So the p95 is mostly six closed-loop readers queueing on one server loop, each bbox listing costing about 17 ms alone, not the bulk inserts. Bulk inserts do show up in the by id read: 20 ms at p95 with no writers against 52 to 105 ms with them, still far under the target.
- The serialisation trial gave no measurable gain, likely because FastAPI 0.142 already serialises the response with Pydantic, so the offline 20 ms path is not the one the app takes. It was reverted. Moving the bulk body validation off the loop would need a raw-body route, which changes the OpenAPI contract, and the readers-only control shows little left to win, so it was not done.
- Autovacuum and autoanalyze fired on both tables at almost every naptime, and dead rows never passed 67. They keep up with this load. The run cannot show that the tuned factors caused that, because at about 1,000 inserts every 4 s the default thresholds (1000 + 0.2 × rows, so 5,600 at 23,000 rows) were also passed at every naptime. The editor's class changes left few dead rows, likely because they were heap-only updates that page pruning cleaned, so the dead-row factor was not exercised either. The counters use `pg_stat_user_tables` estimates, not the `reltuples` Postgres compares against.
- Assumption: one uvicorn process here stands for one Modal container. A hosted runner with four cores running four test workers is slower, so the 250 ms limit may be tight in CI. The test still skips its p95 check when the load average is above the core count.

## Follow-ups

- TODO: watch the hosted db job for this budget. If it flakes there, give the load test its own CI step instead of raising the limit.
- The Neon read replica for reporting costs compute and needs the owner's yes under ADR 0151 (standing approval within $30 a month), so it waits until reporting load exists.
