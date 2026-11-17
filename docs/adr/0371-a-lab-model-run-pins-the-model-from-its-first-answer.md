# 0371. A lab model run pins the model and version from its first answer

- Date: 2026-11-17
- Status: Accepted
- Deciders: the lead of the overnight parallel run (chose option A for what `lab-model-changed` compares against), Claude
- Backlog: JOBS-009 (run a connected lab model). Builds on [ADR 0363](0363-the-model-run-contract-with-parfocal-and-lab-endpoints.md) (the model run contract with Parfocal and lab endpoints) and [ADR 0370](0370-the-project-owner-confirms-tile-sharing-with-a-lab-model.md) (the project owner confirms tile sharing)

## Context

ADR 0363 says a run fails with `lab-model-changed` when the server answers a model or version other than the saved one. A saved lab model stores only the name and version the person typed, such as "Lab HoVer-Net fork" and "v2.1", while the server answers its own, such as "lab-hovernet" and "2.1". Connecting never stores what the server reported, so there is nothing to compare an answer with. A saved model's address cannot change and there is no route that edits or deletes one.

## Decision

- No migration. The worker's `LabDetector` pins the model and version of the first answer of the run and fails the stage with `lab-model-changed` when a later tile answers differently. Migration 0128 with `answered_name` and `answered_version` filled by the connect test was the alternative. It was left out because connecting does not call the server and the saved names are chosen by people.
- The run start resolves a name that is not a Parfocal model against `lab_models`, takes the newest saved version when none is given, and stores the saved name and version. A name that is neither, with or without a version, is refused with `model-not-found`, for the typer too.
- The start is refused with `lab-model-not-allowed` when the project is not on the model's list or the model is for admins and the person lacks admin rights. A clinical project without the owner's confirmation keeps the merged code `lab-model-tiles-unconfirmed` from ADR 0370, although the task text named `lab-model-not-allowed` for it.
- Resume and retry of a run whose saved lab model is gone are refused with `lab-model-changed`. Cancel is always allowed.
- `call_endpoint` takes an optional `SentTile` with the PNG and the level 0 origin, so the test call is unchanged and a run tile goes through the same address, redirect, size and scrubbing rules. The worker reads each tile at the model's magnification, taking 10 microns per pixel at 1x, and pads an edge tile to the square tile size with white.
- Answer coordinates are level 0 pixels, as in the test fixture. Each cell is mapped through the class map, cells mapped to no class are left out, and rings are clipped to the read window. A refused call is retried twice with a growing pause, then the stage fails with `lab-model-` and the refusal, for example `lab-model-status`. An answer without a model and version fails with `lab-model-contract`.

## Consequences

- A pin lives in the detector, so a run resumed by a new worker pins again from its first new tile. A server changed while a run was stopped is not caught across the stop.
- Region objects in an answer are counted in `regions_left_out` and not stored, because the `Detector` protocol returns cells only. Storing them needs a region writer for run results.
- The worker gets a ready `LabModelSpec` with the opened token. Reading the lab model row, checking the project list and confirmation again, and opening the sealed token with the tenant data key at stage start belong to the task that wires model runs into the GPU pool, since `model_running` is used only in tests today.
