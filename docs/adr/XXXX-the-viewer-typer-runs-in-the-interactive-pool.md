# XXXX. The viewer typer runs in the interactive pool behind the warm gate

- Date: 2026-11-17
- Status: Accepted
- Deciders: claude (OPS-025 parallel run)
- Backlog: OPS-025 (the viewer typing tool on a GPU typer runner), part of OPS-017 (switch each area from the fake to the real API)

## Context

The viewer types the outlines a person accepts from smart select and the auto region tool with `POST /api/slides/{slide_id}/outline-types`. Until now only the fake answered it. The person waits on the answer, so it is interactive work, yet the existing `type` kind lives in the job lane, which the warm gate cannot reach. The web drops the whole answer unless it says `calibrated`, and `parfocal_ml.typer` returned raw HoVer-NeXt probabilities. No HoVer-NeXt export exists in model storage yet.

## Options considered

1. Send the outlines as a job to the detector pools. It reuses the job lane, but a job waits for a cold container and a queue, which is far from the one second target for interactive calls.
2. Add an `outline-types` kind to the interactive lane and answer it in the embedder pool, through the warm gate, the way the view map does. The pool holds one more model, and the typer shares its warm container.
3. Run the typer on the API host on CPU. It needs no GPU, but it puts model weights and slide reads in the API container and breaks the rule that models run in the GPU pool.

## Decision

Option 2. The API checks slide reading, refuses with 404 while the AI is hidden for the person, refuses a hidden typer, then sends the outlines with the registry's single view temperature for `pathosam-hovernext` v1.2. Outline points are level 0 slide pixels. The runner groups outlines into 1024 px windows and reads each window at full resolution with a 16 px margin, grown to at least 256 px at the typer's 0.25 µm per pixel so a lone nucleus still has context. It rasterises each ring, averages the HoVer-NeXt class map inside it and applies the temperature to the four viewer classes with the same `scaled` function the calibration fit used. So the answer is `calibrated` only when the registry has a temperature. An outline may span at most 512 px and 4096 numbers and a call carries 1 to 500 outlines, so no read is unbounded. The web skips larger rings before it asks, so one big shape cannot make the whole batch a 422. Any failure, a missing worker or a reply with the wrong count answers 503 `typer-offline`, and the web then leaves the accepts untyped. The audit row `outlines.typed` holds the count, the typer and the GPU seconds, never the points.

The runner loads `hovernext-pannuke` v1.2 `typer.onnx` from model artifacts. Its contract is one `pixels` input of uint8 RGB in NHWC at 0.25 µm per pixel and one output of six class probabilities in NCHW, background first, then the PanNuke order, and it accepts any height and width. Normalisation and softmax live inside the graph, so the runner invents no preprocessing.

## Consequences

The viewer draft count is 0. Until someone exports HoVer-NeXt to that contract and publishes it, the deployed runner fails its setup, the route answers 503, and accepting still works untyped. That export is the next step and needs a backlog task. The pool picks the runner up with the next release. A failed setup closes what it opened and is tried again on the next call. Slides without microns per pixel cannot be typed and answer 503 too.
