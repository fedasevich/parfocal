# Result: annotation reads while bulk inserts run on local Postgres

- Date: 2026-11-15
- Backlog: OPS-004 (database operations)
- Kind: load test
- Commit: the OPS-004 commit on top of `4ec6b2e8`
- Environment: Apple M4 with ten cores, macOS 15, Python 3.14, Postgres 17 with PostGIS and PgBouncer from `compose.yaml`, the API in process through `httpx2.ASGITransport`. The Mac was shared with five other agents, so every run lists its load average
- Data: synthetic 16-point cells of radius 6 px on a 20 px grid, 10,000 seeded and 20,000 more inserted on one slide with one class

## Question

Does a read with database work stay under the [ADR 0003](../adr/0003-pilot-platform-architecture.md) (pilot platform architecture) target of 250 ms at p95 inside the app while bulk annotation inserts run, and do the annotation tables carry the autovacuum settings [ADR 0018](../adr/0018-postgres-sqlalchemy-rls.md) (Postgres, SQLAlchemy and row-level security) planned?

## Method

`apps/api/tests/test_annotation_load.py` seeds 10,000 cells, then two writers each post four bulk batches of 2,500 cells to the same slide while six readers loop until the writers finish. Each reader turn lists a 400 by 400 px viewport with `bbox` (about 400 cells, the shape a viewer asks for) and reads one annotation by id. Every request goes through PgBouncer with row-level security, as in production. The test prints one JSON line with the numbers and `os.getloadavg()` before and after. Run with `uv run pytest -m db apps/api/tests/test_annotation_load.py -s -q -k p95`.

Migration 0122 (annotation autovacuum) sets `autovacuum_vacuum_scale_factor = 0.02`, `autovacuum_vacuum_insert_scale_factor = 0.05` and `autovacuum_analyze_scale_factor = 0.01` on `annotations` and `annotation_versions`, and a second test checks them.

## Results

Runs 1 to 4 built the bulk request bodies inside the timed phase. Runs 5 to 7 built them before it, but the load average had climbed to 25 to 55.

| Run | Load avg before | Reads | Read p50 (ms) | Read p95 (ms) | bbox p95 (ms) | By id p95 (ms) | Batch p50 (ms) | Batch max (ms) | Wall (s) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 3.86 | 278 | 53.5 | 191.3 | not split | not split | 663.2 | 1134.4 | 4.9 |
| 2 | 3.97 | 324 | 58.8 | 242.4 | 261.2 | 112.0 | 1023.6 | 1281.0 | 6.1 |
| 3 | 4.21 | 300 | 69.1 | 264.9 | 267.2 | 110.7 | 980.4 | 1445.6 | 6.1 |
| 4 | 4.32 | 238 | 58.2 | 355.7 | 733.5 | 235.4 | 873.7 | 1628.0 | 6.3 |
| 5 | 25.88 | 120 | 810.5 | 3523.1 | 3641.0 | 787.0 | 5748.8 | 7367.4 | 43.7 |
| 6 | 48.51 | 164 | 287.0 | 821.5 | 910.2 | 654.5 | 2115.1 | 3029.5 | 17.5 |
| 7 | 49.12 | 204 | 229.6 | 746.9 | 913.6 | 515.9 | 2247.2 | 3297.4 | 17.4 |

Every request returned 200 or 201 and the slide held 30,000 rows after each run. Alone, a by id read took about 10 ms and a bbox listing about 68 ms in the request log. No autovacuum or autoanalyze ran on either table within a run, which is expected, because a run lasts 5 to 45 s and the default `autovacuum_naptime` is 60 s.

## Interpretation

- At a load average near 4, the read p95 sits right on the 250 ms target, from 191 to 356 ms with a median of 254 ms. The target is not met reliably, so the OPS-004 "Done when" line is not met yet.
- A by id read that takes 10 ms alone takes 110 ms at p95 under load, so most of the wait is the event loop busy with other requests, not Postgres. A bulk batch of 2,500 shapes parses and validates its body and builds 2,500 GeoJSON strings on the loop, and each bbox listing builds about 400 Pydantic models and serialises about 340 KB.
- Assumption: in this harness the client shares the loop and the CPU with the API, so the numbers are worse than one Modal container would see. The runs on the busy Mac show how much CPU contention matters, not how Postgres behaves.
- An eighth run at a load average of 41.86 had a read p95 of 1461.4 ms, so the test skips its p95 check, after its other checks, when the load average is above the core count. The numbers mean nothing on a machine that busy.
- The budget file holds a regression guard of 750 ms, three times the 254 ms baseline, until the API keeps reads under 250 ms.
- The autovacuum settings are applied but not yet confirmed by an observed autovacuum.

## Follow-ups

- TODO: run the API in its own uvicorn process or thread so the client stops sharing its loop, then measure again on a quiet Mac.
- TODO: if reads still miss 250 ms, move bulk body validation and the bbox serialisation off the event loop, or stream the bbox listing, and lower the budget limit to 250 ms.
- TODO: run a longer load of a few minutes and read `pg_stat_user_tables` to confirm autovacuum and autoanalyze fire with the tuned scale factors.
- The Neon read replica for reporting costs compute and needs the owner's yes under ADR 0151 (standing approval within $30 a month), so it waits until reporting load exists.
