# 0044. Background jobs and workflows on Postgres tables with leases, confirming the default of ADR 0003

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-022 (background jobs and durable workflows). Feeds INGEST-003 (ingest workflow skeleton) and AIP-000 (AI research check), which confirms this choice for the AI batch jobs.

## Context

[ADR 0003](0003-pilot-platform-architecture.md) set the default for STACK-022 to job, step and tile tables in Postgres, steps run by Modal `spawn`, and a Modal cron function that resumes orphaned steps. It set Temporal and Hatchet aside because they need always-on workers and paid plans, and DBOS because it assumes a long-lived process for recovery. This task runs the spike that the default was waiting for and compares the real options with current releases. Versions, licences and prices were read on 2026-10-14.

The constraints are the ones of ADR 0003. One developer, no server to babysit, the lowest fixed cost, Python 3.14 on the backend, and Postgres 17 behind PgBouncer in transaction mode ([ADR 0018](0018-postgres-sqlalchemy-rls.md)). Every tenant-owned table carries `tenant_id` and forced row-level security. The cloud is paused, so Modal could not be tried and the spike ran locally.

The jobs to cover are ingest per uploaded file (quarantine, scan, identify, validate, index, derive, publish), AI batch inference per slide split into tiles, exports and report rendering. Doc 20 section 5 asks that jobs survive a restart.

## Options considered

The measured facts are in [results/2026-10-14-durable-workflow-spike.md](../results/2026-10-14-durable-workflow-spike.md).

1. Job, step and tile tables in Postgres with a lease and `SELECT ... FOR UPDATE SKIP LOCKED`. Spiked. A three-step workflow killed with SIGKILL mid-step resumed in another process from the last completed tile or step, with no duplicate outputs, in all three kill points. It needs no new dependency and runs through the pooler. The cost is that the project owns about 150 lines of claim, lease and resume logic per worker kind, and has no timers, signals or fan-in beyond what it writes itself.
2. DBOS Transact 3.2.0 (MIT, Python 3.10 to 3.14 classifiers). Spiked on Python 3.14.7, directly and through the pooler. It resumed within 0.3 s of a restart and ran the interrupted tile a second time. Its checkpoint is separate from the application's write, so outputs need their own unique keys. A second live process sharing the default executor ID triggered a recovery attempt on a running workflow. Its tables sit outside row-level security and the data-class map. It is the strongest library and the first candidate if the table code outgrows its job.
3. Procrastinate 3.10.0 (MIT, Postgres queue). Not run. It is a task queue, so a stalled job restarts as a whole unless the job code checkpoints, which brings back option 1 inside it. Its package lists no Python 3.14 classifier. Its behaviour behind a transaction-mode pooler is not confirmed.
4. Temporal Python SDK 1.34.0 (MIT). Not run. It gives the richest model and needs a Temporal server. Cloud pay-as-you-go has no minimum, but workers must be reachable and running, which ADR 0003 ruled out for the pilot.
5. Hatchet SDK 1.42.1 (MIT). Not run. Cloud costs $0 to start with 1M runs free and $30 per million after that, and self-hosting needs Postgres plus an engine, API and dashboard. It also needs workers connected to the engine.
6. Celery 5.6.3 (BSD-3-Clause) with Redis. Not run. Its package lists Python up to 3.13 only, it needs a broker that ADR 0003 removed, and it has no step-level durability.
7. Modal scheduling alone. Not run, the cloud is paused. Cron functions run only for a deployed app and cannot be paused, and the page read does not say whether missed runs are caught up. It is useful as the trigger of option 1 but is not a workflow engine.

## Decision

Keep the default of ADR 0003. Jobs and workflows are Postgres tables with a lease, claimed with `FOR UPDATE SKIP LOCKED`, and resumed by whichever worker next claims an expired lease.

Rules for every job kind:

1. A `jobs` table holds status, `lease_until`, `claimed_by` and a claim counter. A `steps` table holds one row per ordered step with its status and run count. Long steps record progress in a per-unit table, such as one row per tile. All three tables carry `tenant_id` and forced row-level security like any other tenant-owned table.
2. A worker claims one job with a single `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED LIMIT 1)`, where a job is claimable when it is queued or when it is running with an expired lease. It renews the lease from a background task at about one third of the lease length. The claim runs under the platform scope and each step runs under the scope of the job's tenant.
3. A step is idempotent. When its effect is a Postgres write, the write and the step or tile checkpoint commit in one transaction. When its effect is outside Postgres, such as an object in R2, the key is derived from job, step and unit so that a second run overwrites the same object.
4. The resumer is the claim query. Locally and in tests it is a restarted worker. In the cloud it is a Modal cron function that runs the claim and starts the step with `spawn`, as in ADR 0003. The cron part is TODO until the cloud is back.
5. Job inputs and step results contain identifiers only. No PHI goes into job rows, logs or error text.
6. The lease length is chosen per job kind in INGEST-003 (ingest workflow skeleton) from measured step durations. The spike used 6 s with a 2 s heartbeat and detected a killed worker after 5.1 to 6.1 s.

The deciding reasons are that the spike met the done-when line with no new dependency, that the checkpoint can share a transaction with the output, and that the tables fit the existing tenant isolation, audit and data-class rules without a second schema outside them.

Triggers that reopen this decision:

| Trigger | Action |
|---|---|
| A workflow needs durable timers, waiting for a signal, or fan-out and fan-in that the tables would reimplement | Re-run the kill test with DBOS Transact, with a distinct executor ID per container and a recovery trigger, and write a new ADR |
| A third job kind needs the same claim and lease code | Move the shared code into a package under `packages/` first, and only then compare libraries |
| Modal cron cannot resume steps reliably once tested | Move the resumer to a small always-on process next to the API and record it in a new ADR |

## Consequences

- No dependency is added. The shared claim, lease and resume code is written in INGEST-003 (ingest workflow skeleton), where its tests are the kill-the-worker test that task already names.
- STACK-022 can be ticked on this spike. Its done-when line says "from the last completed tile", which the `derive` run shows, and the same runs show resume from the last completed step.
- Job tables join the isolation suite and the data map like any tenant-owned table ([knowledge/database.md](../knowledge/database.md)). The spike tables had no `tenant_id`, so the row-level security path of the claim query is TODO and is tested in INGEST-003.
- Doc 20 section 5 is satisfied for restarts of a worker. A restart of the database falls back on the lease and the tables, because job state lives only there.
- Vendor lock-in does not grow. The resumer trigger is the only Modal-specific part and any scheduler can call the claim query.
- Open items, all TODO: the Modal `spawn` and cron run, the Neon pooled endpoint run, the Procrastinate, Temporal and Hatchet kill tests, and the lease length per job kind.
- The edit to the STACK-022 text, a link to this ADR and a tick, is left to the owner of the backlog.

## Sources

- DBOS recovery and executors: https://docs.dbos.dev/architecture and https://docs.dbos.dev/python/tutorials/workflow-tutorial
- Procrastinate: https://procrastinate.readthedocs.io/en/stable/
- Temporal pricing: https://temporal.io/pricing
- Hatchet pricing and self-hosting: https://hatchet.run/pricing and https://docs.hatchet.run/self-hosting
- Modal schedules: https://modal.com/docs/guide/cron
- Package metadata (versions, licences, classifiers) read from https://pypi.org/pypi/NAME/json (NAME is the package name) on 2026-10-14 for procrastinate, dbos, temporalio, hatchet-sdk, celery and modal.
