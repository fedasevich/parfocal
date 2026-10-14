# Result: A three-step workflow that survives SIGKILL, on Postgres tables and on DBOS

- Date: 2026-10-14
- Backlog: STACK-022 (background jobs and durable workflows)
- Kind: spike
- Commit: c8e03ee. The spike code lived in a temporary directory outside the repository and was deleted afterwards. The worker, schema and claim query are described in the Method section.
- Environment: Apple M4, macOS 15.8.1, Docker 29.8.1, the repository's compose stack (Postgres 17.10 with PostGIS on port 5432 as owner `parfocal`, trust auth, and PgBouncer 1.26.0 on port 6432 in transaction mode with `max_prepared_statements = 1000`). CPython 3.14.7, asyncpg 0.32.0, dbos 3.2.0 with psycopg 3.3.6. Everything ran on one machine with no other load. No cloud service was touched.
- Data: a scratch database per run (`spike_workflow` and `spike_dbos`) with made-up job rows and no PHI. Both databases were dropped afterwards.

## Question

Can a three-step workflow be killed with SIGKILL in the middle of a step and be resumed by another process from the last completed step, with no duplicate outputs? The backlog text of STACK-022 says "from the last completed tile", so the long step is split into 20 tiles and the run also shows tile-level resume. [ADR 0003](../adr/0003-pilot-platform-architecture.md) set the default to job, step and tile tables in Postgres with a resumer, and this spike checks that default against DBOS Transact, the one library that claims the same behaviour in-process. No budget exists for recovery time. The numbers below are for the record and for the lease-length choice in INGEST-003 (ingest workflow skeleton).

## Method

Table approach, measured first.

1. Tables `jobs` (status, `lease_until`, `claimed_by`, `claims`), `steps` (job, ordinal, name, status, `runs`), `tiles` (job, step ordinal, tile, worker) and `outputs` (primary key on job, step ordinal and tile). The `outputs` primary key is the duplicate detector.
2. One workflow with three steps. `scan` sleeps 1.0 s and writes one output. `derive` has 20 tiles of 0.25 s, and each tile inserts its output row and its `tiles` row in one transaction. `publish` sleeps 1.0 s and writes one output.
3. A worker is a Python process with an asyncpg pool that connects through PgBouncer on port 6432 as `parfocal_app`. It claims a job with the query below, renews `lease_until` every one third of the lease from a background task, skips steps whose status is `done`, and inside `derive` skips tiles that already have a `tiles` row. The lease was 6 s and the heartbeat 2 s.

```sql
UPDATE jobs SET status = 'running', claimed_by = $1, claims = claims + 1,
  lease_until = clock_timestamp() + make_interval(secs => $2)
WHERE id = (
  SELECT id FROM jobs
  WHERE status = 'queued' OR (status = 'running' AND lease_until < clock_timestamp())
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING id
```

4. A driver script creates the scratch database, inserts one job and starts worker A. It sends SIGKILL to A when a chosen point is reached (after `tile 8` printed for the `derive` run, shortly after `scan start` for the `scan` run, shortly after `publish start` for the `publish` run). It then starts worker B immediately and records when B claims the job and when it prints `job done`. It reads the tables for the final counts.
5. A second script inserts 12 jobs and starts three workers at once with shorter steps (4 tiles of 0.05 s) to check that `SKIP LOCKED` hands each job to one worker.

DBOS approach.

6. The same workflow written with `@DBOS.workflow()` and `@DBOS.step()`. Each tile is one step, so the workflow has 22 steps. Every step execution inserts a row into an `executions` table, and its output into `outputs` with `ON CONFLICT DO NOTHING`, from a separate connection, so a repeated execution can be seen.
7. The driver starts process A, which calls `DBOS.launch()` and starts the workflow with a fixed workflow ID. It sends SIGKILL after `tile 8` printed, then starts process B, which only calls `DBOS.launch()` and waits. The DBOS system database was the scratch database, reached directly on port 5432 in the first run and through PgBouncer on port 6432 as `parfocal_app` in the second.
8. A last run starts process B while process A is still alive and working, with both using DBOS's default executor ID, to see what the launch-time recovery does to a live workflow.

Versions of the candidates were read from the PyPI JSON API on 2026-10-14 (`https://pypi.org/pypi/<name>/json`). Pricing and behaviour were read from the vendor pages listed under Sources.

## Results

### Table approach, SIGKILL during each step

Lease 6 s, heartbeat 2 s, through PgBouncer. Times are from the driver's monotonic clock.

| Kill point | Seconds from start to kill | Seconds from kill to B claiming the job | Seconds from kill to `job done` | Runs of scan, derive, publish | Tiles by A and by B | Rows in `outputs` |
|---|---|---|---|---|---|---|
| In `derive` after tile 8 | 3.38 | 5.12 | 8.95 | 1, 2, 1 | A 9 (0 to 8), B 11 (9 to 19) | 22, all distinct |
| In `scan` | 0.37 | 6.11 | 13.28 | 2, 1, 1 | A 0, B 20 | 22, all distinct |
| In `publish` | 6.51 | 5.64 | 6.66 | 1, 1, 2 | A 20, B 0 | 22, all distinct |

An earlier run of the first row, before the driver was changed to stop measuring at `job done`, claimed the job 5.12 s after the kill and had the same counts. Its total time included a 20 s idle exit of the worker and is not used.

Worker B logged `scan skipped, already done` and `derive start with 9 of 20 tiles already done` in the first row. In every row the job ended with status `done`, `claims` 2 and `outputs` holding 1 row for scan, 20 for derive and 1 for publish.

### Table approach, three workers and 12 jobs

| Measure | Value |
|---|---|
| Jobs finished | 12 of 12 |
| Smallest and largest `claims` of any job | 1 and 1 |
| Jobs claimed by each worker | 4, 4, 4 |
| Rows in `outputs` and distinct keys | 72 and 72 |
| Largest `runs` of any step | 1 |

### DBOS, SIGKILL after tile 8

| Measure | Direct on port 5432 | Through PgBouncer on port 6432 |
|---|---|---|
| Seconds from start to kill | 5.71 | 3.83 |
| Seconds from kill to B finishing `DBOS.launch()` | 0.31 | 0.28 |
| Seconds from kill to the first tile of B | 1.64 | 1.58 |
| Seconds from kill to `job done` | 5.63 | 5.54 |
| Executions of derive by A and by B | 9 (tiles 0 to 8), 12 (tiles 8 to 19) | 9 (tiles 0 to 8), 12 (tiles 8 to 19) |
| Tiles executed twice | tile 8 | tile 8 |
| Rows in `outputs` | 22 | 22 |
| Rows in `dbos.operation_outputs` | 22 | 22 |
| Recovery attempts recorded | 2 | 2 |

B's log said `Recovering 1 workflows from application version 8d3b7522e7a5cfdca73814d8071a70f0` and `Executor ID: local` at launch. The status query ran straight after `job done` was printed and still read `PENDING`, so the final status write had not landed yet. DBOS applied its own migrations up to number 123 into schema `dbos` on first launch, in both runs.

Tile 8 was killed after its output was written and before its step result was saved, so it ran again. That is the at-least-once behaviour the DBOS page describes.

### DBOS, a second process launched while the first is alive

| Measure | Value |
|---|---|
| Recovery attempts recorded for the workflow | 2 |
| Warning in process A | `Workflow spike-wf-1 is no longer owned by this execution. Waiting for the owner's recorded outcome` |
| Final workflow status | `SUCCESS` |
| Rows in `executions` and in `outputs` | 23 and 22 |
| Step executions recorded by process B | 0 |

Process A went on to run publish and print `job done`. One derive tile executed twice. Why process B recorded no executions was not investigated.

### Candidates

Read on 2026-10-14. "Classifiers" means the Python versions listed in the package's PyPI classifiers.

| Option | Version and date | Licence | Python 3.14 | Notes |
|---|---|---|---|---|
| Table with `SKIP LOCKED` (this spike) | none | none | ran on 3.14.7 | No new dependency, the code in this spike was about 150 lines |
| Procrastinate | 3.10.0, 2026-09-23 | MIT classifier | requires `>=3.10`, no 3.14 classifier, not run | "Python 3.10+ distributed task processing library, leveraging PostgreSQL 13+" per its docs |
| DBOS Transact | 3.2.0, 2026-09-29 | MIT | classifiers 3.10 to 3.14, ran on 3.14.7 | Depends on SQLAlchemy 2, psycopg 3, websockets, PyYAML, click and python-dateutil |
| Temporal Python SDK | 1.34.0, 2026-09-30 | MIT | classifiers 3.10 to 3.14, not run | Needs a Temporal server. Cloud pay-as-you-go has no minimum and $150 of credit for 90 days |
| Hatchet SDK | 1.42.1, 2026-10-09 | MIT | requires `<4,>=3.10`, no classifiers, not run | Cloud pay-as-you-go is $0 to start with 1M runs free, then $30 per million runs. Self-hosting needs Postgres plus an engine, API and dashboard, with RabbitMQ optional |
| Celery | 5.6.3, 2026-03-26 | BSD-3-Clause | classifiers 3.9 to 3.13, not run | Needs a broker such as Redis. [ADR 0003](../adr/0003-pilot-platform-architecture.md) removed Valkey |
| Modal scheduling | modal 1.6.1, 2026-10-03 | Apache-2.0 | requires `<3.15` | Schedules run only when the app is deployed and cannot be paused. Retries and catch-up of missed runs are not documented on the page read. Cloud is paused, so nothing ran |

## Interpretation

1. A process killed with SIGKILL in any of the three steps was resumed by a second process with no duplicate outputs. The `derive` run is the one the backlog asks for. It resumed from the last completed tile (tile 9) and skipped the finished `scan` step. These are facts of this run.
2. The detection delay of the table approach equals the lease. B claimed the job 5.1 to 6.1 s after the kill with a 6 s lease and a 2 s heartbeat. A shorter lease detects death sooner and risks a second worker starting while the first is only slow. The production lease is a choice for INGEST-003 and is TODO until step durations are known.
3. The table approach made the output and its checkpoint one transaction, so a killed tile left nothing half done and ran once. A step whose effect is not a Postgres write (an object written to R2) cannot join that transaction. Such a step needs an output key derived from job, step and tile so that running it twice overwrites the same object. This is a design rule, not something the spike measured.
4. DBOS resumed within 0.3 s of the restart, because a restarted process takes over the pending workflows of its executor ID at launch. The cost is that its checkpoint is separate from the application's write, so the interrupted tile ran twice. The duplicate was harmless only because the output table had a unique key.
5. The last DBOS run shows that two live processes sharing the default executor ID interfere. Launching one while the other worked produced a recovery attempt, an ownership warning and one repeated tile. DBOS documents Conductor or manual recovery for multi-process setups. Modal can run several containers at once, so a DBOS design there needs a distinct executor ID per container and a recovery trigger. This is an inference from one local run and was not tried on Modal.
6. DBOS worked through the transaction-mode pooler in this setup, with the system database on port 6432. Whether it works through Neon's pooler is TODO because the cloud is paused.
7. DBOS stores workflow inputs and step results in its own `dbos` schema, which has no `tenant_id` and no row-level security. That is a reading of the schema it created, not something the spike tested against [ADR 0018](../adr/0018-postgres-sqlalchemy-rls.md) or the data classes of [ADR 0028](../adr/0028-data-classes-on-columns.md).
8. Candidates other than the table approach and DBOS were compared on documentation and package metadata only, and were not run.

## Follow-ups

- [ADR 0044](../adr/0044-background-jobs-and-workflows.md) records the decision.
- TODO: run the same kill test with a step that runs as a Modal function started with `spawn` and a Modal cron function as the resumer, when the owner re-opens the cloud. The local spike used a restarted worker as the resumer.
- TODO: test the claim query and the checkpoint transaction against Neon's pooled endpoint, with the scope set per tenant. The spike tables had no `tenant_id` and no row-level security.
- TODO: run Procrastinate, Temporal and Hatchet through the same kill test if the decision is reopened. Confirm how Procrastinate behaves behind a transaction-mode pooler, since its docs page read here did not say.
- TODO: find out why process B recorded no step executions in the two-live-processes DBOS run, and whether Conductor has a price that matters at the pilot size.
- TODO: choose the lease and heartbeat for ingest in INGEST-003 (ingest workflow skeleton) from measured step durations.

## Sources

- Procrastinate docs: https://procrastinate.readthedocs.io/en/stable/ and package https://pypi.org/project/procrastinate/
- DBOS architecture and recovery: https://docs.dbos.dev/architecture and https://docs.dbos.dev/python/tutorials/workflow-tutorial, package https://pypi.org/project/dbos/
- DBOS queue tutorial: https://docs.dbos.dev/python/tutorials/queue-tutorial
- Temporal pricing: https://temporal.io/pricing and package https://pypi.org/project/temporalio/
- Hatchet pricing: https://hatchet.run/pricing, self-hosting: https://docs.hatchet.run/self-hosting, package https://pypi.org/project/hatchet-sdk/
- Celery package: https://pypi.org/project/celery/
- Modal schedules: https://modal.com/docs/guide/cron and package https://pypi.org/project/modal/
