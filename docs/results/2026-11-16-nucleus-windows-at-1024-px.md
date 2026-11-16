# Result: feeding the PathoSAM encoder native 1,024 px windows fails the AINUC-001 reference, so the nucleus job keeps its 640 px windows

- Date: 2026-11-16
- Backlog: AINUC-011 (throughput target)
- Kind: check
- Commit: 34cd3a64 plus `workers/ml/spike/nuclei_window_size_check.py`, which this change adds
- Environment: Apple M4 Mac, onnxruntime 1.31.1 on `CPUExecutionProvider`, local graphs `pathosam.encoder.onnx` and `pathosam.ais_decoder_full.onnx` from `~/.cache/parfocal/models/onnx`. No cloud run
- Data: `CMU-1-Small-Region.svs` (OpenSlide test data, 0.499 µm/px) and the AINUC-001 (detector runner) reference `workers/ml/tests/fixtures/pathosam-ais-cmu-1-small-region.json`, 366 nuclei made by the POC in PyTorch. No PHI

## Question

The throughput run of the same day ([2026-11-16-nucleus-job-throughput-on-l4.md](2026-11-16-nucleus-job-throughput-on-l4.md)) projected 2.56 hours on one L4. Its tiles are cut into 640 px windows (512 px core and a 64 px halo) that are scaled up to 1,024 px for the encoder, 16 windows per tile. Do 1,024 px windows passed without upscaling (896 px core and the same 64 px halo) still match the reference within the tolerance of `test_fixed_region_matches_the_pytorch_reference`?

## Method

`uv run --package parfocal-ml --extra tumor python workers/ml/spike/nuclei_window_size_check.py`

1. The reference region, slide window (1000, 1000, 512, 512), is read and resized with PIL bilinear to 1,022 model px, as the weights test does. It runs once with each window size through `stitched_maps`, `instances` and `traced`.
2. Each run is compared with the reference by the weights test's three limits: the count within 1%, at least 95% of reference centres with a detected centre closer than 1 slide px, and a median area ratio between 0.95 and 1.05. One slide px is 2 model px on this fixture, so the script matches within 2 model px.
3. As a second look at a tile the size of the job's tiles, slide window (300, 700, 828, 828) is resized to 1,653 model px and the 896 px core output is compared the same way with the 512 px core output.

## Results

| Run | Nuclei | Count change | Matched | Median area ratio |
| --- | ---: | ---: | ---: | ---: |
| Reference, 512 core, 64 halo (current) | 366 of 366 | 0.0% | 97.5% | 0.976 |
| Reference, 896 core, 64 halo | 269 of 366 | −26.5% | 45.1% | 1.130 |
| 1,653 px tile, 896 core against 512 core | 319 against 316 | +0.9% | 64.6% | 1.115 |
| Limit in the weights test | | within ±1% | at least 95% | 0.95 to 1.05 |

## Interpretation

- The current runner passes the reference, so the check itself is sound. With 1,024 px windows the reference region fits one window and takes the single-pass branch, so the failure comes from the encoder seeing nuclei at a different pixel size, not from stitching.
- The encoder needs nuclei at about 1.6 times the 0.25 µm/px model scale, the scale the POC also used. 1,024 px windows fail all three limits, so the change is not shipped and `nuclei.py` is unchanged.
- No GPU run was made. At 16 windows per tile the GPU passes alone take about 6,540 s on an L4 (earlier result), so running the CPU post-processing during the GPU work cannot reach one hour by itself.

## Follow-ups

- AINUC-011 stays in progress at the measured 2.56 hour projection. Ideas that keep the encoder scale, none of them measured: splitting each 1,656 px tile into 3 by 3 windows instead of 4 by 4, where today 7 of the 16 windows are thin slivers at the tile edge, skipping windows without tissue, half precision or the TensorRT provider on the L4. Each must pass the same reference check before a GPU run. `TODO`
