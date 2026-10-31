# Jobs and workflows

How background work runs, from [ADR 0044](../adr/0044-background-jobs-and-workflows.md) and INGEST-003 (ingest workflow skeleton).

## The engine lives in parfocal_common.jobs

`jobs`, `job_steps` and `job_units` are defined in `parfocal_common.jobs` and re-exported by `parfocal_api.tables`, so migrations, the data map and the isolation suite see them. A workflow is a `Workflow(kind, steps, lease_seconds)`, and a step is `Step(name, run)`, where `run` takes a `StepRun` and returns a small JSON result of ids and counts. `enqueue()` creates the job and one row per step in the caller's transaction.

## Claims run under the platform scope, steps under the workspace

`claim()` uses `DatabaseScope(platform=True)`, and the `platform_claims` policy on `jobs` lets it see every workspace's queue. Everything else (lease renewal, step status, units) runs under the job's workspace scope, so a step can only touch its own workspace's rows. A job is claimable when it is queued, or running with an expired lease, and `SKIP LOCKED` hands it to one worker.

## Steps must be idempotent

A finished step is skipped on a rerun. A long step reads `done_units()` and records each unit with `mark_unit()` in the same transaction as the unit's output, so a killed worker's successor carries on from the last unit and nothing is written twice. `test_a_killed_worker_is_resumed_without_duplicate_outputs` kills a real worker process with SIGKILL in the middle of a step and checks this.

## Failing on purpose and by accident

A step raises `StepFailedError("code")` to stop the job with that code. Later steps stay pending. Any other exception crashes the worker, and the job is claimed again when its lease runs out. TODO: cap the number of claims so a step that always crashes ends as failed.

## Pausing, cancelling and the controls

Since AIP-008 (job model and API) the engine also knows `paused`, `cancelling` and `cancelled` ([ADR 0123](../adr/0123-model-runs-are-engine-jobs-per-slide.md), model runs as engine jobs per slide). It keeps `done` rather than `succeeded`, because the ingest worker, the generated client and older tests read it. A step raises `StepPausedError("reason")` to park the job with `pause_reason` set and no lease, and the step goes back to pending. A long step checks `should_stop()` between units and raises `JobStoppedError` when it is true, which happens when a person cancelled or the lease went to another worker. `run_job` also checks before every step. `finish` changes a job only while this worker holds it (`claimed_by`) and it is running or cancelling, and a cancelling job ends as cancelled unless the worker reached the end, which ends it as done.

`move(connection, job_id, JobControl.X)` is the person's side and runs in the workspace scope. Cancel turns queued and paused jobs and running jobs with an expired lease into cancelled, and running jobs with a live lease into cancelling. Resume takes paused and cancelled jobs back to queued, and retry does the same for failed ones. Both set running and failed steps to pending, clear the claim and keep done steps and units, so the next claim carries on. A disallowed move returns `Move(before, None)` and the route answers 409. `claim` first ends every cancelling job whose lease has run out, because nobody else would, and it takes an optional `tenant_id` so a test or a workspace's own worker claims only that workspace's jobs. Tests must pass it: every test in a session shares one database, so a claim without it can take another test's queued job.

`set_total(n)` stores a stage's denominator in `job_steps.units_total`. The numerator is the count of its `job_units`, so progress per stage is free once a step marks its units.

## Model runs

`parfocal_common.model_runs` holds the kind `model-run`, the six stages (`tiles-read`, `tissue-found`, `model-running`, `objects-placed`, `ids-given`, `result-set-added`, the steps JOBS-004 (job window with steps per slide) draws), the `model_runs` table keyed by the job id, `enqueue_model_run`, `claim_model_run` and `workflow(stages)`, which refuses a mapping that misses a stage. `PLAN` has placeholder steps that raise, like the ingest plan, so the API never imports a worker. One job is one slide, and slides started together share `batch_id`. The job input holds only the slide id, and the worker reads the scope and parameters from the `model_runs` row through `ClaimedRun.settings`. The app role cannot update or delete `model_runs` rows, since everything that changes is in `jobs`. There is no model worker yet, so `test_model_runs.py` drives the stages with fake step functions through `claim_model_run` and `run_job`.

## Running a worker

`python -m parfocal_ingest --database-url ... --workflow module:WORKFLOW` runs workers locally, and `--idle-exit` stops one after it has been idle. The ingest workflow is `parfocal_ingest.workflow:INGEST`, with placeholder steps for quarantine, scan, identify, validate, index, derive and publish that INGEST-004 to INGEST-017 fill in. Its lease is 60 s until real step durations are measured (TODO). The kind, the step names and the lease live in `parfocal_common.ingest`, so the API queues the job with `enqueue_ingest` without importing the worker, and a test checks that the worker's `INGEST` has the same kind and steps. A completed upload queues it with the input `{"upload_id": ...}` only, because the file name is PHI and job input is classed operational. The quarantine step reads the upload record for the key. Project members read a job's status at `GET /api/projects/{project_id}/jobs/{job_id}`.
