# 0363. A model run names its model by name and version, and a lab endpoint is called per tile through the same function as its test

- Date: 2026-11-17
- Status: Accepted
- Deciders: the agent doing JOBS-000 (research check for the model run contract), under the build-the-obvious rule
- Backlog: JOBS-000 (research check for the model run contract). Builds on AIP-008 (job model and API), [ADR 0123](0123-model-runs-are-engine-jobs-per-slide.md) (model runs as engine jobs per slide) and [ADR 0263](0263-lab-model-endpoints-with-sealed-credentials.md) (lab models as saved endpoints)

## Context

AIP-008 and JOBS-001 (model run API) built the run side, and JOBS-005 (connect a lab model) built the lab endpoint side. Nothing yet says in one place what a run promises to a model, and a lab model cannot be run: `model_runs.resolved` and `model_catalogue` know only Parfocal models, and the ML worker has no detector that calls an endpoint.

## Decision

The contract as built for Parfocal models.

- A run is one `model-run` job per slide with six stages, and `model_runs` holds the project, slide, optional task, `batch_id`, scope (slide, view or selection), detector and typer with versions, test-time views, tile order and tier.
- A person gives a model by name, an optional version or a tier. The API resolves it to an exact name and version and stores those, so a run never changes with the catalogue.
- The worker side is the `Detector` protocol in `parfocal_ml.whole_slide`: a `classes` count and `detect(window)` that returns cells for one tile. A tile is a unit, so a killed worker resumes from the last marked tile.
- Every run opens a result set (source `run`) at the start, and the `result-set-added` stage closes it.

The contract for lab endpoints, built on what JOBS-005 already stores.

- A lab model is chosen by its saved name and version in `lab_models`, and the run records them as the detector, like a Parfocal model. The start is refused with `model-not-found` when the model is not saved, and with a new `lab-model-not-allowed` when the project is not in `lab_model_projects` or the person is outside `who_can_run`.
- The worker gets a `LabDetector` that implements `Detector`. It reads the endpoint and opens the sealed token with the tenant data key at the start of the stage, never earlier and never in the job input.
- Each tile goes through `parfocal_common.lab_model_call.call_endpoint`, so the address rules, the no-redirect rule, the size cap and the log scrubbing of the test apply to every run call. The request and answer are the same JSON as the test: a base64 PNG with its size, magnification and level 0 origin, answered with model, version and polygon objects.
- Answer objects are mapped through the saved `class_map` and clipped to the tile. An answer whose model name or version differs from the saved one fails the stage with `lab-model-changed`, so a result set never carries a version nobody chose.
- A refused address, a timeout or an error status on a tile is retried twice with a pause, then the job ends failed with the refusal code. It does not pause, because the person must fix the server.
- A lab model can be a detector. It cannot be a typer until a lab server contract for typing exists.
- Test-time views call the endpoint once per view, and a lab run's estimate comes from measured runs only, since there is no mock number.

## Consequences

- JOBS-001 or a new task builds `lab-model-not-allowed`, the `LabDetector`, the `lab-model-changed` check and the run-time token read. Until then the run API refuses lab models as unknown.
- Tiles of a run leave Parfocal for the lab's server. J3 (tiles of a clinical project go to a server nobody expected) is met only by the per-project list in `lab_model_projects`, so clinical projects need an explicit tile-sharing confirmation on that list when the model is connected. This is open for the owner.
- Cancelled runs still leave an open result set. The worker task must close it.
