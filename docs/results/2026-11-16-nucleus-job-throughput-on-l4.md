# Result: the nucleus detector job would take about 2.6 hours on test_001 on one L4, so the one-hour target is out of reach as built

- Date: 2026-11-16
- Backlog: AINUC-011 (throughput target)
- Kind: benchmark
- Commit: the AINUC-011 commit that adds this file and `workers/ml/spike/nuclei_slide_run.py`
- Environment: Modal environment `dev`, ephemeral app `parfocal-spike-nuclei-throughput` (`ap-ZLkLuhnjZFcV2X29ZzC8w5`, task `ta-01M7HV9BR5GZ1SBZF1Q4QB589R`), region `us-east`. One NVIDIA L4 (driver 610.57.04, 23,034 MiB), memory `(8192, 16384)` MiB and Modal's default CPU, which are the `detector_best` pool's limits from `parfocal_ml.gpu_pool`. The image is the pool's own `pool_image()` (CUDA 13.3.1 with cuDNN, Python 3.14, onnxruntime-gpu 1.31.1 from `workers/deploy/locks/ml.txt`), with the two graphs added as local files. Both graphs ran on `CUDAExecutionProvider`
- Data: CAMELYON16 `test_001.tif` (CC0), read from `parfocal-dev/fixtures/` and checked against its SHA-256 `eda774b4…`. No PHI

## Question

Does the whole-slide nucleus job process a CAMELYON16 slide on the chosen GPU in under one hour? The POC's laptop estimate was ten hours.

## Method

`PARFOCAL_ENV_FILE=<root>/.env uv run --package parfocal-ml modal run -e dev workers/ml/spike/nuclei_slide_run.py --out reply.json`, one call, with a 70 minute function timeout.

1. The GPU is the one the `detector_best` pool names, an L4 at 0.25 µm/px, the stricter row of ADR 0349 (PathoSAM AIS stays the detector and HoVer-NeXt the typer in every tier).
2. The slide is read the way `StoredSlides` reads a stored slide. `ObjectStore.download` fetches it to local disk inside the container, `stored_slides.opened` opens it with OpenSlide and builds the thumbnail, and the tissue mask is `SlideImage.tissue()`. The storage key came from the root `.env` as an ephemeral Modal secret and was used for one GET under `fixtures/`.
3. The job is composed from the pieces that exist, because no worker runs nuclei on the pool yet. `plan_tiles` with `tile_sizes(0.226321, 0.25)` gives tiles of 1,697 slide px with a 66 px halo, 1,149 of them touching tissue. `run_tiles` runs `PathoSamDetector` (Quality BEST) with `OnnxPathoSam` on each tile and encodes its chunk with `tile_chunk`. The reader resizes each level 0 region with PIL bilinear, as the AINUC-001 tests do. Chunks went to an in-memory store, so the R2 upload of real chunks is not counted.
4. Each tile is 1,656 model px, which `stitched_maps` cuts into 16 windows of up to 640 px, each scaled to 1,024 px for the encoder. That gives 18,372 encoder and decoder passes for the slide.
5. One warm-up tile, then 8 tiles spread evenly over the plan. The projection is the time spent so far plus the mean seconds per tile times the 1,141 tiles left. The run stops when the projection is above 1.15 hours, so the full slide was not run.
6. A local CPU pass of the same code path, and one dense tile on an Apple M4 CPU, checked the logic before the GPU run. The dense tile held 3,349 owned cells, well under the 65,536 a chunk allows.

## Results

| Measure | Value |
| --- | ---: |
| Slide | 86,016 × 89,600 px at 0.226 µm/px, 61.27 mm² of tissue |
| Tiles planned, BEST | 1,149 |
| Tiles run | 8 (128 windows), plus 1 warm-up tile |
| Cells detected, stored after ownership | 6,965, 5,935 |
| Chunk bytes for 8 tiles | 490,088 |
| Download of 1,142,160,268 bytes from R2 | 20.4 s |
| Open, thumbnail, tissue mask and plan | 0.7 s |
| Model load | 2.2 s |
| Warm-up tile (16 windows) | 7.8 s |
| Seconds per tile, mean of 8 | 7.98 |
| Wall time in the function until the stop | 94.9 s |
| Projected wall time for the slide | 9,198 s, 2.56 hours |
| Projected seconds per mm² of tissue | 150 |
| GPU memory in use at the end | 13,583 MiB |

Where a tile's 7.98 s goes, from timers around each part:

| Part | Seconds per tile | Share |
| --- | ---: | ---: |
| Encoder and decoder, 16 windows (0.356 s a window) | 5.70 | 71% |
| Post-processing on the CPU (smoothing, watershed, tracing) | 2.04 | 26% |
| Region read and resize | 0.21 | 3% |
| Chunk encoding | 0.03 | under 1% |

The container waited about 20 minutes for L4 capacity before it started. That wait is not billed and is not in the wall time.

Cost: $0.0178 in Modal's billing report for the app, and no other app ran.

## Interpretation

- The one-hour target is not met as built. The projection is 2.56 hours on one L4, about four times faster than the POC's ten-hour laptop estimate and about 2.2 times faster per mm² than the 333 s on the M4 CPU (detector throughput result of 2026-11-06).
- The GPU passes alone would take about 6,540 s for 18,372 windows. So no CPU work can bring the job under an hour while every tile runs 16 windows.
- Each 640 px window is scaled up to 1,024 px before the encoder, so most of the GPU time is spent on upsampled pixels. Only 65 of the 1,149 tiles lie fully on tissue, yet every tile runs all 16 windows.
- Arithmetic from the measured parts, not a measurement: 1,024 px windows would need 4 per tile, about 1.4 s of GPU per tile. Run alone, that gives about 3.7 s per tile and 4,300 s per slide. If the CPU post-processing ran while the GPU worked on the next window, the slower side (about 2.3 s per tile) would set the pace, giving about 2,700 s. Larger windows change the pixel size the encoder sees, so they must first match the reference on the AINUC-001 fixture.
- Not measured here: the typer (no HoVer-NeXt graph is in the pool image, so this is the detector only), the T4 at 0.33 µm/px (749 tiles on this slide), half precision and the TensorRT provider, skipping windows without tissue, and the real chunk upload to R2.
