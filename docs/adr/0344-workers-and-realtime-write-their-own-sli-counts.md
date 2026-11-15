# 0344. Workers and realtime write their own SLI counts, and only automatic whole-slide runs are pre-reads

- Date: 2026-11-15
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: OPS-018 (SLI events from the workers, a realtime SLI and traces). Amends [ADR 0343](0343-sli-counts-in-the-slide-bucket-and-otlp-logs-over-http.md) (SLI counts in the slide bucket, OTLP logs over HTTP)

## Context

ADR 0343 read ingest and pre-read times from `jobs` rows at every alert cycle, counted every `model-run` job as a pre-read, and gave realtime no SLI. Reading finished rows means one query per workspace over three days of jobs at every cycle, and a hand-started model run on a small view is not the pre-read the SLO promises.

## Options considered

1. Keep reading finished jobs from the database and add a pre-read filter. No worker change, but the cycle keeps scanning three days of rows.
2. Each worker writes a count batch to `ops/sli/batches/` when a job settles, through the same `SliEmitter` the API uses, and the cycle reads only open jobs for the ones still running past their threshold.

## Decision

Option 2.

| Part | Where |
|---|---|
| Job hook | `run_job` and `work` take `on_settled`, called after every job however it ended. `parfocal_common.job_sli.JobSli` reads the row and counts a done or failed ingest or pre-read, failed or late as bad, then flushes one batch |
| Pre-read | A `model-run` job whose run has no `started_by_user_id` and scope `slide`. `counts_toward_an_slo` is the one SQL condition for both the hook and the cycle |
| Workers | The ingest worker builds its emitter with `worker_sli` and flushes at exit. A GPU loop that drives model runs through `work` or `run_job` passes the same hook |
| Alert cycle | `job_rows` reads only queued or running jobs that count, so a stuck job still pages while finished jobs come from the batches |
| Realtime | New SLO `realtime`, 99 percent of room publish and revoke calls reach the edge. `EdgeRealtime` counts each call on the API or worker emitter |

## Consequences

- A worker that dies between finishing a job and writing its batch loses that one count. Stuck jobs still page from the open rows.
- In tests (`APP_ENV=test`) workers keep counts in memory only, as the API does.
- Traces are still not exported. Requests remain one `sli.api.request` log record each, as ADR 0343 says. Spans need the OpenTelemetry SDK question in a new ADR.
- The realtime SLI covers the API and worker side of the room channel. Socket health inside the edge is not counted yet.
