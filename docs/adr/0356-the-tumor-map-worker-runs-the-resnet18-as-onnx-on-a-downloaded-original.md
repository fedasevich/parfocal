# 0356. The tumor map worker runs the ResNet18 as ONNX and reads a downloaded original through OpenSlide

- Date: 2026-11-16
- Status: Accepted
- Deciders: Yurii Fedas, proposed by the agent doing AITUM-010 (the tumor map job reads stored slides and runs the tumor model in its pool)
- Backlog: AITUM-010. Builds on ADR 0351 (the v1 tumor model stays the MONAI CAMELYON ResNet18), ADR 0355 (the tumor map job shares the detector-good T4 pool) and ADR 0043 (the reader of record per format).

## Context

AITUM-008 (the tumor map runs as a job and the API serves it) left two seams, a slide opener and a scorer. The opener must give level 0 regions and a thumbnail of a stored slide, and the scorer must run the ResNet18 in the detector-good pool. The pool image has neither torch nor onnxruntime, and the ML package has no slide reader. `RegionReader.read` is synchronous and `ObjectStore` is asynchronous with no range read.

## Options

1. Runtime. A: torch and MONAI in the pool image. B: the ResNet18 exported once to ONNX and run by onnxruntime, as the PathoSAM models already are.
2. Reader. A: ranged GETs through tifffile, decoding tiles ourselves. B: stream the original to the container's disk and read it with OpenSlide.

## Decision

1B and 2B.

The ONNX graph has a fixed input of 1 by 3 by 2,240 by 2,240, one tile, and returns the 64 by 64 logits. Exported from bundle 0.6.4 it is 44.7 MB and matches torch within 1.9e-7 on a tile of `CMU-1-Small-Region.svs` ([result](../results/2026-11-16-tumor-resnet18-onnx-parity.md)). It is published as the model artifact `camelyon-tumor` `v1.0` `model.onnx`, which the worker fetches with its checksum. onnxruntime picks CUDA when present and CPU otherwise, so the same scorer runs in the CPU stand-in.

`parfocal_ml.stored_slides.StoredSlides` finds `original.*` under the slide's prefix, reads `levels.json` for the size, microns per pixel and level count the viewer uses, streams the original to a temporary folder, and opens it with OpenSlide. Regions are read from disk one tile at a time and the thumbnail is built at downsample 64, the level the evaluated spike used for the tissue mask, in strips of 512 rows, so no whole slide is ever in memory. The download is kept for both steps of a job and removed when the job's slide changes or the claim loop ends. A slide without an original fails with `tumor-map-slide-missing`. A zip, a DICOM set, an OME-TIFF that OpenSlide cannot open and a slide whose OpenSlide size differs from `levels.json` fail with `tumor-map-unreadable-slide`.

## Why

- ONNX keeps torch and its 2 GB of wheels out of the pool image and reuses the export, artifact and runtime path the PathoSAM models already use.
- OpenSlide is the reader the v1 model was measured with (ADR 0351, MLEVAL-005 tumor map evaluation), so the colours match the measured FROC. Decoding JPEG tiles ourselves risks a wrong colour transform that still gives a plausible map.
- A download costs one sequential read of the original, about 1 to 2 GB for a CAMELYON slide, against thousands of ranged GETs.

## Consequences

- The deployed pool still needs `onnxruntime-gpu`, `openslide-bin` and a cuDNN base image in `workers/deploy/locks/ml.txt`, the `camelyon-tumor` artifact in R2, and the database and storage secrets on the pool function. That wiring is the next step and is not done here.
- MIRAX, DICOM and OME-TIFF originals get no tumor map until a reader for them is added. Leica SCN is refused too, because OpenSlide's level 0 of `Leica-1.scn` is 53130 by 153470 against the 36832 by 38432 main image that ingest and the viewer use. `CMU-1-Small-Region.svs`, `CMU-1.ndpi`, `Argos-1.avs`, `OS-1.bif`, `tumor_009.tif` and `test_001.tif` agree.
- The ML worker parses an original that ingest already parsed inside its sandbox. OpenSlide runs in the pool container without that sandbox.
