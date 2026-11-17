# XXXX. The project owner confirms tile sharing before a lab model runs on a clinical project

- Date: 2026-11-17
- Status: Accepted
- Deciders: owner (decision 138, tile sharing when a lab model runs on a clinical project, answered A), Claude
- Backlog: JOBS-008 (confirm tile sharing before a lab model joins a clinical project). Closes the open point in [ADR 0363](0363-the-model-run-contract-with-parfocal-and-lab-endpoints.md) (the model run contract with Parfocal and lab endpoints)

## Context

A lab model is a server the lab runs, so every tile it scores leaves Parfocal for that server. JOBS-005 (connect a lab model) stores which projects may use a model in `lab_model_projects`, and nothing else stood between a clinical project's slides and the lab's server. The owner chose an explicit, recorded confirmation by the project owner, once per model and project.

## Decision

- The confirmation lives on the `lab_model_projects` row as `tiles_confirmed_at` and `tiles_confirmed_by_user_id`, added by migration 0127 (lab model tile sharing). A separate table or a JSON column on `lab_models` was the alternative. The row already is the per-model, per-project fact, so deleting the row clears the confirmation and adding it again starts unconfirmed.
- "Clinical" is read from `projects.privacy_mode` when it is checked and is never copied onto the row.
- Only the project's owner confirms. Connecting takes `confirmed_project_ids`, and confirming a project the person does not own is refused with `lab-model-tiles-owner-only`. An owner can also confirm later through `POST /api/tenant/models/{model_id}/projects/{project_id}/tile-sharing`. A second confirmation keeps the first time and adds no audit event.
- Every confirmation writes `lab-model.tiles-confirmed` with the server host and the project. Adding and removing a project write `lab-model.project-added` and `lab-model.project-removed`, and the removal says whether a confirmation was cleared.
- The run start checks a detector that is not a Parfocal model against the saved lab models. A project not on the model's list is refused with `lab-model-not-allowed`, and a clinical project without a confirmation with `lab-model-tiles-unconfirmed`.
- A confirmation names the model's server. A saved model's address cannot change, and in the connect form changing the address clears every confirmation given for the old one.

## Consequences

- An admin who is not the clinical project's owner can add the model to it, but it cannot run there until the owner confirms. The project's settings tab lists its lab models from `GET /api/projects/{project_id}/lab-models`, and the owner confirms a pending one there with the same dialog the connect flow uses. Other members see that it waits for the owner.
- The run start still accepts an unknown model name when a version is given, so a confirmed lab model gets past the gate and is refused only by the worker. The lab run path that ADR 0363 describes closes this.
