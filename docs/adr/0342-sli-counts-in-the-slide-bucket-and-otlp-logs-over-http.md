# 0342. SLI counts and alert state live in the slide bucket, and telemetry leaves as OTLP logs over plain HTTP

- Date: 2026-11-15
- Status: Accepted
- Deciders: Parfocal agents, owner to review
- Backlog: OPS-006 (observability stack). Builds on [ADR 0340](0340-slos-and-alerts-as-code-routed-by-email.md) (SLOs and alerts as code, sent by email) and [ADR 0040](0040-observability-and-phi-scrubbing.md) (observability and PHI scrubbing)

## Context

ADR 0340 left SLI samples, firing alerts and the cross-workspace watermarks in memory, which every cold start forgets. Web runs up to 4 Modal containers, ingest up to 2, tile latency is measured in the edge Worker, and nothing runs all the time. No migration slot was free for this task, no paid service may be added, and [ADR 0005](0005-external-sends-only-in-production.md) (external sends only in production) keeps Grafana Cloud off outside production. The project has no OpenTelemetry SDK, and the Modal image installs from a lock file.

## Options considered

1. Keep SLI samples and alert state in a new Postgres table. Transactional, but needs a migration, and every request or tile would wake Neon, which then never scales to zero.
2. Each process writes small JSON batches of good and bad counts per minute under `ops/sli/batches/` in the slide bucket, and one evaluator folds them into `ops/alerting/state.json` with the firing alerts and watermarks. No migration and no new service, and R2 operations stay far inside the free tier. The evaluator must be the only writer, and a batch lost with a killed isolate is lost.
3. Send SLI events only to Grafana Cloud and alert there. Durable, but untestable locally and back to vendor-only rules, which ADR 0340 rejected.

For export, the OpenTelemetry Python SDK with its OTLP exporter was weighed against a small OTLP/HTTP JSON log exporter over `httpx2`. The SDK brings several packages into both locks and the image for a handful of event types. The small exporter is about 100 lines and is tested against a fake collector.

## Decision

Option 2, and the small OTLP/HTTP log exporter.

| Part | Where |
|---|---|
| API availability | `SliMiddleware` counts every HTTP response, 5xx as bad, and flushes once a minute has closed and at shutdown |
| Tile latency | The edge Worker counts tile responses, 5xx or slower than 60 ms as bad, and refused tokens not at all. It writes one batch per isolate after 30 s through the `SLIDES` binding |
| Ingest and pre-read time | Read from `jobs` rows at evaluation time. A queued or running job past its threshold counts as bad, a paused one does not. The clock starts at job creation, which approximates "slide ready" for pre-reads |
| Evaluation | `run_alert_cycle` loads the state, folds new batches, evaluates the burn rules, runs the cross-workspace watch with the stored watermarks, exports `slo.status` per SLO, saves, then deletes the folded batches. A batch whose delete failed is skipped by key on the next cycle |
| Retention | Counts older than the longest burn window plus one hour are pruned |
| Export | `OtlpLogExporter` posts scrubbed attributes to `OTLP_ENDPOINT/v1/logs` with `OTLP_HEADERS`. It is built only when `TELEMETRY_EXPORT=otlp`, the production default, and fails at startup without an endpoint |
| Real-user monitoring | The viewer times animation frames only within 1 s of a pointer, wheel or key input on the stage, so an idle tab sends nothing. It reports renderer, frame count, p50, p95 and frames over 50 ms once a minute and on page hide, by beacon to `POST /api/telemetry/frames`, which needs a session and refuses extra fields. Outside production it logs to the console |
| Synthetic error | `POST /api/platform/drills/synthetic-error` for platform operators raises `SyntheticError`, which reaches the error reporter and counts as a 5xx. Three calls page through the next cycle |
| Dashboards | `parfocal_common.dashboards` generates `infra/grafana/parfocal-overview.json` from the SLOs and the emitted event names. A test fails when the file is stale or a panel reads an event or field the code does not emit or allow-list |

New allow-listed keys are `ok`, `renderer`, `frames`, `p50_ms`, `p95_ms`, `long_frames`, `slo`, `good_permille` and `burn_tenths`, all numbers or fixed choices.

## Consequences

- Nothing evaluates in production until `python -m parfocal_api.alert_cycle` runs on a schedule. The deploy test `test_the_app_deploys_no_cron` forbids a Modal cron today, so the schedule is an owner question in `docs/decisions.md`. Every DB check wakes Neon, so a 5 minute cadence that also reads jobs and the audit trail would keep it awake around the clock.
- Two evaluators running at once could double count or lose a fold. The schedule must not overlap.
- The API and the edge must write to the same bucket. Both use `parfocal-dev` today. TODO: confirm when production gets its own bucket.
- Traces are not exported. Each request leaves as one `sli.api.request` log record with route, status and duration, which covers latency by route. If spans are needed, the SDK question comes back as a new ADR.
- The dashboard is not imported into Grafana and the production export is not proven. Both wait for the owner to create the Grafana Cloud stack, and the 70 percent quota alerts of ADR 0040 need its real limits.
- Realtime rooms emit no SLI yet. Their panel waits for a room event.
- A database outage stops the cycle before any page goes out, and mail is sent before the state is saved, so a failed save repeats the mail next cycle. Both are known limits.
- Every `model-run` job counts as a pre-read, including runs a person started by hand. Narrowing it to automatic whole-slide runs is a follow-up.
- Until the cycle is scheduled, deployed API containers and the edge write batches to the bucket that nothing folds or prunes.
