# 0418. Find nuclei runs PathoSAM AIS on the best detector pool

- Date: 2026-11-21
- Status: Accepted
- Deciders: agent on PROTO-145
- Backlog: PROTO-145 (whole slide cell detection starts, and a review shows only its own runs)

## Context

The deployed walkthrough of v0.34.1 saw Find nuclei on the whole slide stay queued with 0 attempts for 17 minutes. The cause is in the code. Only the lab model worker ever claims a model run, and it claims only lab runs (`Detectors.LAB`). The API wakes a GPU pool only for a lab run, and no pool has a runner for the `detect` kind. A Parfocal model run therefore waited for a worker that did not exist. The viewer also sent `hovernet`, which the registry marks retired, while AINUC-001 (the detector runner) and ADR 0202 (the v1 model line-up per tier) make PathoSAM AIS the nuclei detector.

## Options considered

1. Keep `hovernet` and serve PathoSAM under it. This needs no client change, but the result set would be titled "HoVer-Net v0.9" while another model drew it.
2. Send the shipped `pathosam-hovernext` model and run its PathoSAM ViT-B encoder with the full AIS decoder on a GPU pool through the existing `PathoSamDetector` and `whole_slide.run_tiles`. The result set carries the right name, and the tested tiling, resume and chunk code is reused.
3. Refuse at the API every Parfocal detector without a worker. This is honest, but it changes the answers of many existing tests for runs that the engine tests start with `hovernet`.

## Decision

Option 2. The viewer sends `pathosam-hovernext`. `parfocal_ml.nuclei_run_worker` drains Parfocal runs (`Detectors.PARFOCAL`) in the `detector_best` pool (L4) with the kind `detect`. It reads the slide, plans tiles only where the thumbnail shows tissue, inside the run's view or selection box, runs PathoSAM at 0.25 µm per pixel for Best and 0.33 for Good or Fast, and records GPU seconds. A Parfocal detector that has no worker, such as `hovernet` or `camelyon-tumor` started as a model run, fails with the code `model-not-served` instead of waiting. The API wakes the pool on start, resume, retry and move. Cells are untyped for now, because the HoVer-NeXt typer runs only on outlines a person asks for.

The weights are published as the model artifact `pathosam-vit-b-ais` `v1.2` with `workers/ml/spike/publish_pathosam_ais.py`, which accepts only the measured encoder and decoder files.

## Consequences

- A run with no tissue tiles ends done with zero tiles and no GPU time, so a blank slide costs nothing.
- The whole slide run still has no tumor first order, because no tumor map probability reaches the worker yet. Tiles go in raster order.
- A whole slide run holds one L4 for its whole length, and the pool's timeout is the Modal maximum. A run that outlives a container resumes on the next wake, because finished tiles are units.
- Typing the found cells with HoVer-NeXt is a follow-up.
