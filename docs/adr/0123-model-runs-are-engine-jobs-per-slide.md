# 0123. A model run is one job per slide in the shared job engine, with cancel, pause, resume and retry in the engine

- Date: 2026-10-31
- Status: Proposed
- Deciders: Yurii Fedas (to confirm), proposed by the agent building AIP-008 (job model and API)
- Backlog: AIP-008 (job model and API), shapes JOBS-001 (model run API), JOBS-003 (jobs tray), JOBS-004 (job window with steps per slide), AIP-009 (resumable whole-slide jobs), AIP-011 (job progress streaming), AIP-013 (result chunk store) and AIP-014 (AI cost and usage metering), leaves JOBS-000 (research check for the model run contract) open

## Context

AIP-008 (job model and API) asks for jobs per slide and task with a scope (view, selection or whole slide), parameters (detector, typer, test-time augmentation, ordering), a state, progress per stage, and cancel, resume and retry. Since [ADR 0053](0053-ai-results-review-direction.md) (AI results review direction) a model runs only when a person starts it, and every run on a slide becomes a result set ([ADR 0077](0077-result-sets.md), result sets). [ADR 0044](0044-background-jobs-and-workflows.md) (background jobs on Postgres tables with leases) already gives `jobs`, `job_steps` and `job_units` with claims, leases, step skipping and per-unit resume, and the ingest and retention workflows run on it. The engine knew only queued, running, done and failed.

Four facts in the code narrowed the choice before any option was weighed. `result_sets.job_id` already points at `jobs.id`. The notification kinds model run finished and model run paused in the NOTIF-006 (notification catalogue) catalogue target a `job`, and the resolver reads `jobs.project_id` by that id. JOBS-004 (job window with steps per slide) draws one row of steps per slide (queued, tiles read, tissue found, model running, objects placed, IDs given, result set added). AIP-009 (resumable whole-slide jobs) resumes a slide by skipping tiles already written, which is what `job_units` records.

Four questions needed an answer: whether model runs live in the shared engine or in a table of their own, how big one job is, which states and moves exist, and who may see a run.

## Options considered

Where runs live:

1. A separate `model_jobs` table with its own status, leases and claim query. It could be shaped freely, but it copies about 150 lines of claim, lease and resume logic that ADR 0044 (background jobs on Postgres tables with leases) already tested with a killed worker, and `result_sets.job_id` and the notification resolver would need a second target.
2. Rows in the shared engine with the kind `model-run`, plus a `model_runs` row keyed by the job id that holds what only a model run has. This reuses claims, leases, step skipping and units, and the existing links work unchanged. The engine has to learn pausing and cancelling, which then serve every job kind.

How big one job is:

1. One job for everything a person started, with one step per slide and stage. The run is one row, but a worker holds every slide under one lease, slides cannot run in parallel on several GPUs, and a failure on one slide fails all of them.
2. One job per slide, with one step per stage. Each slide has its own lease, progress, result set and retry, which is what JOBS-004 (job window with steps per slide) draws and what Modal can fan out. Slides started together share a `batch_id`, so a tray can still show them as one run.

States:

1. Only the existing four, with cancel as a flag on the row. Cheap, but a queued job that was cancelled reads as queued, and a paused run has nowhere to say why.
2. Add `paused`, `cancelling` and `cancelled`, and keep `done` rather than renaming it `succeeded`, because the ingest worker, `getProjectJob`, the generated client and the ingest tests already use `done`.

Who sees a run:

1. Only people who read the whole project. Simple, but [ADR 0069](0069-slide-pipeline.md) (slide pipeline) derives the AI running state of a task slide from its queued or running job, and a reviewer's slide view must be able to show it.
2. Everyone who reads the slide, through the same `require_slide_reading` and `readable_slide` rules as result sets, so a reviewer sees runs only on the slides of their tasks, and nobody sees a run on a slide where the AI is hidden from them because their first read is still open ([ADR 0118](0118-blinding-and-a-kept-first-read.md), blinding and a kept first read).

## Decision

Model runs are jobs of the kind `model-run` in the shared engine, one per slide, with the six stages `tiles-read`, `tissue-found`, `model-running`, `objects-placed`, `ids-given` and `result-set-added` as steps. `model_runs` is keyed by the job id and holds the project, the slide, an optional review task, the `batch_id`, the scope kind and its data, the detector and typer with their versions, the number of test-time views, the tile order and who started it. It reuses every part of ADR 0044 (background jobs on Postgres tables with leases), and the existing links from result sets and notifications need no change. It is in `parfocal_common.model_runs`, next to `parfocal_common.ingest`, so the API queues runs without importing a worker.

The engine gains three states and two columns. `jobs.pause_reason` holds why a job is paused, and `job_steps.units_total` holds the denominator of a stage's progress, while the numerator stays the count of its `job_units`.

| Move | Allowed from | Goes to |
|---|---|---|
| Cancel, by a person | queued or paused | cancelled |
| Cancel, by a person | running with a live lease | cancelling |
| Cancel, by a person | running with an expired lease | cancelled |
| Resume, by a person | paused or cancelled | queued |
| Retry, by a person | failed | queued |
| Claim, by a worker | queued, or running with an expired lease | running |
| Stop, by the worker | cancelling | cancelled |
| Pause, by the worker | running | paused, with a reason |
| Fail, by the worker | running | failed, with a code |
| Finish, by the worker | running or cancelling | done |

Any other move is a 409 problem (`model-run-not-cancellable`, `model-run-not-resumable` or `model-run-not-retryable`) that names the current state. Resume from cancelled is the Undo that JOBS-004 (job window with steps per slide) offers after a cancel. Resume and retry set running and failed steps back to pending and keep done steps and every recorded unit, so the next claim skips finished stages and finished tiles. A worker that reaches the end while the job is cancelling still ends it as done, because all of its work exists and cancelling keeps what is finished anyway. A claim first ends every cancelling job whose lease has expired, so a worker that dies after a cancel cannot leave it cancelling forever. A worker whose lease was taken over can no longer end or pause the job, because every end is guarded by `claimed_by`.

Starting and controlling runs is a new permission, `run-models`, which researchers hold and reviewers do not, and which inside a project only owners hold. Viewers read runs. Reviewers read the runs on their task slides, as the option of letting everyone who reads the slide see its runs describes. Service accounts get no scope for it yet. Start, cancel, resume and retry go into the hash-chained audit log as `model-run.started`, `model-run.cancelled`, `model-run.resumed` and `model-run.retried`.

The model is chosen loosely for now. A detector and an optional typer are each a name and a version string, because AIP-002 (model registry) does not exist yet. Test-time augmentation is the number of views, 1 or 8 as in the POC's dihedral augmentation, and 8 needs a typer because the POC applied it to the typer only. The order is `raster` or `tumor-first`, the POC's two values. Unknown parameters are refused with the usual 422 problem.

## Consequences

- Migration `0046` (model runs) widens the `jobs.status` check, adds `jobs.pause_reason` and `job_steps.units_total`, and creates `model_runs` with forced row-level security. The app role has no `UPDATE` or `DELETE` on `model_runs`, because a run's changing state lives in `jobs`.
- Ingest and retention jobs get the new states for free. No route cancels them yet.
- A worker builds its workflow with `parfocal_common.model_runs.workflow(stages)`, claims with `claim_model_run`, and runs it with the engine's `run_job`. A stage reports progress with `set_total` and `mark_unit`, checks `should_stop` between tiles and raises `JobStoppedError`, `StepPausedError(reason)` or `StepFailedError(code)`. `claim` takes an optional workspace, which a lab's own worker for JOBS-005 (connect a lab model) can use.
- JOBS-001 (model run API) replaces the name and version strings with a registry reference once AIP-002 (model registry) exists, creates each slide's result set with source `run` and the job id, and sends the finished and paused notifications. Their target is the job id, which already resolves. It may turn `batch_id` into a run row of its own if the tray needs more than a shared id.
- JOBS-000 (research check for the model run contract) stays open. This decision fixes how a run is stored, shown and controlled, not how Parfocal calls a model, so the contract with Parfocal and lab endpoints, and whether the worker or the endpoint tiles the slide, are still to be decided there.
- AIP-011 (job progress streaming) reads progress and per-stage start and end times from `job_steps`, and AIP-014 (AI cost and usage metering) can attribute GPU time through `model_runs` to the workspace, the job and the model.
- TODO: the claim count still has no cap, so a stage that always crashes the worker is claimed forever. A retry counts as another claim in `attempts`.
