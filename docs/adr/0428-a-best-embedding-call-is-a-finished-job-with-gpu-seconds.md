# 0428. A Best embedding call is a finished job with its GPU seconds

- Date: 2026-11-21
- Status: Accepted
- Deciders: agent on PROTO-158
- Backlog: PROTO-158 (a result import notice, GPU seconds for Best and names for hand drawn outlines)

## Context

The deployed walkthrough of v0.35.8 found that the GPU seconds of a Smart select Best embedding call (POST /embeddings/view) land only in the audit event `view.embedded`. GET /api/tenant/ai-usage reads the `gpu_usage` table, whose `job_id` is required and points at `jobs`, and the call has no job. So the budget view misses every Best call.

## Options considered

1. Make `gpu_usage.job_id` nullable and add slide and project columns. This changes the table, the tenant key and the ai usage contract, where `recent_jobs[].job_id` would become optional.
2. Write one finished `jobs` row of kind `view-embedding` per answered call, then a `gpu_usage` row on that job. No schema change, and ai usage lists the call like any job.
3. Read the audit events inside ai usage. Audit is a record of who did what, not a meter, and the query would join two sources.

## Decision

Option 2. The job id is a UUID5 of the tenant and the GPU call id, and the job is inserted with `ON CONFLICT DO NOTHING`, so an answer fetched twice with the same call token counts once. The job is born `done` with `finished_at` set, its input holds the slide id, and ai usage takes the slide from there when the job has no model run. The seconds are the ones the encoder reports, or the wait when it reports none, the same figure the audit event keeps. The model is the encoder name and version, and the tier is `best`.

## Consequences

- Each Best call adds one small `jobs` row. Job lists are read through their own tables (model runs, uploads, exports), so these rows show in no tray or list, and no worker claims them because they are never queued or running.
- Other synchronous GPU calls, such as outline typing, can use the same pattern when they need metering.
- Option 1 stays open if the jobs table ever grows too large from these rows.
