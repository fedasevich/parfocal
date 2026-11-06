# XXXX. The detector runner stitches full-resolution PathoSAM AIS maps over 512 px windows and runs them on onnxruntime

- Date: 2026-11-06
- Status: Accepted
- Deciders: Yurii Fedas (to confirm), proposed by the agent building AINUC-001 (detector runner)
- Backlog: AINUC-001 (detector runner). Builds on [ADR 0202](0202-v1-model-line-up-per-tier.md) (the v1 model line-up), [ADR 0240](0240-one-working-chunk-per-tile.md) (one working chunk per tile) and [ADR 0246](0246-pathosam-onnx-export-contract.md) (the PathoSAM ONNX export contract)

## Context

AINUC-001 runs PathoSAM automatic instance segmentation (AIS) over each whole-slide tile that [ADR 0240](0240-one-working-chunk-per-tile.md) plans. ADR 0202 fixes 512 px windows with a 64 px halo, 0.25 µm/px for best and 0.33 µm/px for fast, smoothed outlines and no HoVer-Net. The POC ran PyTorch, which `workers/ml` does not install outside the `export` extra. AISEG-001 (ONNX export pipeline) exports the AIS decoder with a 2 × 2 average pool down to 512 px, which the browser needs. POC doc 19 (whole-slide nuclei) found that per-instance work over the whole label map is quadratic.

## Options considered

1. PyTorch in the worker, as the POC did. It adds torch to the Modal image and a second runtime next to the browser's graphs.
2. onnxruntime with the browser's pooled AIS decoder. On a fixed CMU-1-Small-Region window it found 340 nuclei against the PyTorch reference's 366, and only 78% of reference centres had a detection within 2 px.
3. onnxruntime with a full 1024 px AIS decoder graph, the same weights without the pool. Its maps match PyTorch within 1.0e-4 and it finds the same 366 nuclei.

## Decision

Option 3. `parfocal_ml.nuclei` stitches the maps of each 512 px window core, read with its 64 px halo, into one map per tile, then runs one seeded watershed and traces each instance on its own `find_objects` crop with a Gaussian smoothed sub-pixel contour, so the cost grows with the pixels and never with pixels times instances. A window follows SAM's own preprocessing: the longest side scaled to 1024 and the rest padded with zero after normalising. The export pipeline writes `pathosam.ais_decoder_full.onnx` next to the browser graphs, and the runner refuses a decoder whose maps are not 1024 px. onnxruntime sits in a new `onnx` extra of `parfocal-ml`. Weights stay in the models cache and are never committed.

## Consequences

- The full decoder is slow and large on a CPU. On an Apple M4 a 640 px window peaks near 8 GB of resident memory. The [result](../results/2026-11-06-nuclei-detector-throughput.md) has the measured seconds per mm². GPU numbers on Modal are `TODO` until a cloud run is approved.
- Cells are written unclassified with the mean foreground probability as their score. Typing stays with the HoVer-NeXt typer tasks.
- The reference test runs only with the `weights` marker, since it needs the graphs and the CMU-1-Small-Region fixture.
