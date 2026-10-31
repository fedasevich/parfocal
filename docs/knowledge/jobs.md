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

## Running a worker

`python -m parfocal_ingest --database-url ... --workflow module:WORKFLOW` runs workers locally, and `--idle-exit` stops one after it has been idle. The ingest workflow is `parfocal_ingest.workflow:INGEST`, with placeholder steps for quarantine, scan, identify, validate, index, derive and publish that INGEST-004 to INGEST-017 fill in. Its lease is 60 s until real step durations are measured (TODO). The kind, the step names and the lease live in `parfocal_common.ingest`, so the API queues the job with `enqueue_ingest` without importing the worker, and a test checks that the worker's `INGEST` has the same kind and steps. A completed upload queues it with the input `{"upload_id": ...}` only, because the file name is PHI and job input is classed operational. The quarantine step reads the upload record for the key. Project members read a job's status at `GET /api/projects/{project_id}/jobs/{job_id}`.
