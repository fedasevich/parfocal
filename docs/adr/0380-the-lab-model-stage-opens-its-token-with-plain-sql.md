# 0380. The lab model stage opens its token with plain SQL and stores regions per tile

- Date: 2026-11-17
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: JOBS-010 (the GPU pool runs a lab model stage). Builds on [ADR 0371](0371-a-lab-model-run-pins-the-model-from-its-first-answer.md) (a lab model run pins the model from its first answer) and [ADR 0378](0378-saved-import-sources-keep-credentials-on-the-server.md) (saved import sources keep their credentials on the server)

## Context

ADR 0371 (a lab model run pins the model from its first answer) left three jobs to the worker that runs model stages: read the saved lab model row, check the project list and the clinical tile confirmation again, and open the sealed token with the tenant data key. The ingest worker does this for import sources by importing `parfocal_api`. The GPU pool image ships only `parfocal_common` and `parfocal_ml`, and its locked requirements hold none of the API's dependencies. A lab answer also carries region objects, which the detector counted and dropped.

## Decision

- The stage reads `model_runs`, `lab_models`, `lab_model_projects`, `projects`, `result_sets` and `tenant_keys` with plain SQL text, as `SEAL_RESULT` already does. The GPU pool does not depend on `parfocal_api`.
- The field context and the data key unwrap move into `parfocal_common.sealed_fields`, and the API's `context` calls the same function, so the sealing and the opening cannot drift apart. The taxonomy templates move into `parfocal_common.taxonomies` for the same reason, and `class_templates` re-exports them.
- At stage start a saved model gone or renamed fails with `lab-model-changed`, a project off the model's list fails with `lab-model-not-allowed`, and a clinical project without a tile confirmation fails with `lab-model-tiles-unconfirmed`, all before any call. A token that cannot be opened fails with `lab-model-sealed`. The stage runs inside its own log context, the opened token is registered there as sensitive at once, and it never enters the step result.
- A region whose class maps to a taxonomy class is clipped to its tile window and written to `result_objects` of the run's result set in the same transaction that marks the tile done. A resumed tile therefore never writes its regions twice. Lab tiles have no halo, so a region crossing tiles is stored as one piece per tile. A region whose clipped outline is not valid is skipped, and an unmapped region is counted in `regions_left_out`.
- Cells and regions keep the index of their class in the model's taxonomy. When the tiles are done the stage pins those classes in `result_set_classes`, by position, matched to the project's classes through its class mappings or by name, with the count of cells and regions of each.
- A run started with a lab model carries `lab_model` in its job input. `claim_model_run` takes `Detectors.LAB` or `Detectors.PARFOCAL`, so a lab drain never claims a run of a Parfocal detector and the other way round. The marker sits on the job because the claim runs in the platform scope, which cannot read the tenant tables `model_runs` and `lab_models`.
- The GPU pool app gets a `lab-model` function with no GPU, one container and the database and storage secrets, which carry `MASTER_KEYS`. It drains lab runs. Its other five stages only mark themselves done, because the lab server does the whole job, and every tile of the slide is sent, since there is no tissue pass.

## Alternatives

- Adding `parfocal-api` to the ML worker would let it call `load_keys` and `open_field` directly, but it would put the whole API and its dependencies into the GPU image.
- Writing all regions once at the end of the stage would be simpler, but a stop in the middle would lose the regions of tiles already marked done.

## Consequences

- Starting a lab run spawns the `lab-model` function once per request, as a tumor map spawns its pool, and a failed spawn still leaves the run queued. The function is not deployed yet. Runs queued before this change carry no marker and are left to a Parfocal drain.
- The cells are stored as tile chunks but not registered in `result_chunks`, so the sealed result set counts its regions and not its cells.
- Sending every tile of the slide costs more lab calls than a tissue-first plan would.
- `who_can_run` is checked only when the run starts, because the stage has no person to check.
