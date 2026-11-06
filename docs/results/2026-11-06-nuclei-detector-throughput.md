# Result: the PathoSAM AIS detector runner matches the PyTorch reference and takes 252 to 333 s per mm² on an Apple M4 CPU

- Date: 2026-11-06
- Backlog: AINUC-001 (detector runner)
- Kind: benchmark
- Commit: the AINUC-001 branch commit that adds this file
- Environment: Apple M4 laptop, 24 GB, macOS 15 (Darwin 24.6), Python 3.14, onnxruntime 1.31.1 on `CPUExecutionProvider`. The POC reference ran in the POC's own Python 3.12 venv with PyTorch on MPS. No cloud runs.
- Data: the public OpenSlide test slide `CMU-1-Small-Region.svs` (0.499 µm/px, 2220 × 2967), no PHI

## Question

Does `parfocal_ml.nuclei` reproduce the POC's PathoSAM AIS output on a fixed region, and how many seconds per mm² does it take at the best (0.25 µm/px) and fast (0.33 µm/px) resolutions?

## Method

Graphs come from the models cache, `~/.cache/parfocal/models/onnx`: the fp32 encoder and `pathosam.ais_decoder_full.onnx`, the AIS decoder exported from `vit_b_histopathology_decoder.pt` with no pooling at opset 17. This run's decoder was exported with the POC venv, the same graph the new `export_ais_decoder_full` in `parfocal_ml.sam_onnx.export` writes. The encoder was the POC's fp32 export, whose embeddings matched PyTorch within 1.8e-6.

The reference is the POC `PathoSamAis.detect_blocks` on the level-0 window at (1000, 1000), 512 × 512, resized with PIL bilinear to 1022 × 1022 (0.25 µm/px), minimum area 20 and outline smoothing 1. Its 366 centres and areas are committed in `workers/ml/tests/fixtures/pathosam-ais-cmu-1-small-region.json`.

`uv run pytest workers/ml/tests/test_nuclei_weights.py -m weights -s` runs both checks in one process with one model loaded. Throughput times one `PathoSamDetector.detect` call after a warm-up call, reading from the slide held in memory, so slide decoding is not counted. The memory peak was read with `/usr/bin/time -l` on the reference region.

## Results

Maps of one 576 px window against PyTorch:

| Decoder graph | Max abs difference | Nuclei on the fixed region | Reference centres with a detection within 2 model px |
| --- | --- | --- | --- |
| Browser AIS decoder, pooled to 512 px (AISEG-001 export) | 0.40 | 340 | 78.1% |
| Full 1024 px AIS decoder | 1.0e-4 | 366 | 97.5% |

The reference has 366 nuclei. With the full decoder the median centre distance is 0.54 model px and the median area ratio is 1.00. The remaining distance comes from the two outline simplifiers (OpenCV `approxPolyDP` in the POC, scikit-image `approximate_polygon` here) placing vertices differently, since centres are vertex means.

Throughput, warm, one call per region:

| Region (level 0) | Area | Resolution | Nuclei | Seconds | Seconds per mm² |
| --- | --- | --- | --- | --- | --- |
| 512 × 512 at (1000, 1000) | 0.0653 mm² | best, 0.25 µm/px | 366 | 14.26 | 218.5 |
| 512 × 512 at (1000, 1000) | 0.0653 mm² | fast, 0.33 µm/px | 276 | 14.03 | 214.9 |
| 1536 × 1536 at (300, 700) | 0.5875 mm² | best, 0.25 µm/px | 1,399 | 195.78 | 333.3 |
| 1536 × 1536 at (300, 700) | 0.5875 mm² | fast, 0.33 µm/px | 1,267 | 148.05 | 252.0 |
| POC PyTorch on MPS, 512 × 512 at (1000, 1000) | 0.0653 mm² | best | 366 | 33.88 | 518.8 |

The process peaked at 8.19 GB resident memory on the small region with the full decoder.

## Interpretation

- The runner reproduces the reference when the decoder is the full one, and the pooled browser graph does not. That is why the runner refuses a decoder whose maps are not 1024 px.
- Cost follows the number of 640 px windows. The small region needs 4 windows at both resolutions, so fast saves nothing there. The larger region needs 36 windows at best and 25 at fast, and fast takes 0.76 of the time.
- The larger region took more seconds per window than the small one, 5.4 s against 3.6 s. The run was on a laptop with other work open, so treat the larger region's figure as the CPU number to plan with.
- CPU time on the M4 is far from a GPU's. The L4 and T4 figures on Modal are `TODO` until a cloud run is approved. The CoreML provider was tried once and did not finish compiling the encoder before the machine restarted, so it was not measured.
