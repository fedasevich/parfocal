# Result: overlay GPU time on the Viv route at overview with 81k real nuclei

- Date: 2026-11-17
- Backlog: VIEW-028 (overlay level of detail)
- Kind: benchmark
- Commit: 0ca625b2 with the harness changes of this result on top (`packages/viewer-engine/gpu-bench`)
- Environment: MacBook with Apple M4 (24 GB), Darwin 24.6.0, Chrome 157 headed (`channel: "chrome"`), WebGL2 on ANGLE Metal, canvas 2880 by 1800 at a pixel ratio of 2, one worker, one browser at a time. One-minute load averages of 3.1 to 5.1 while other agents ran. Nothing ran on the Linux CI runner.
- Data: `Huron-1-40x.tif` (public OpenSlide test data, 12040 by 21006) with 81,278 nuclei that the POC's whole-slide PathoSAM job found on it (POC doc 27 names the same 81,278), and the synthetic grid of 81,225 squares on `synthetic-zlib.ome.tiff`. No PHI.

## Question

At overview, with the real 81k nuclei of a whole slide, does the overlay cost under 1 ms of GPU time a frame on the Viv route?

## Method

`pack-poc-nuclei.py` in `packages/viewer-engine/gpu-bench` packs the 76 chunk files of the POC job (`poc/server/fixtures/wsi/Huron-1-40x/9cf0330d3b5d`) into one binary file of starts and positions. Then, in `packages/viewer-engine`:

```
GPU_TIMING_NUCLEI=/path/huron-nuclei.bin nice -n 10 pnpm exec playwright test -c playwright.gpu.config.ts --workers=1 gpu-bench/gpu-timing.spec.ts
```

The new test opens Huron-1-40x on the real Viv route, fits the whole slide to the canvas (0.043 CSS pixels per slide pixel, so a nucleus is far below 2 px and the density tier draws) and sets the 81,278 nuclei as one overlay. It times 20 warm-up and 120 measured frames with no overlay, then with the overlay, then with no overlay again, all at the same camera after the route is idle. Each frame is a forced `deck.redraw` timed with `EXT_disjoint_timer_query_webgl2`. The overlay share is the larger of the two differences, with minus without before and with minus without after. The test fails when the overlay changes no pixel of the canvas or when the share is 1 ms or more. Before this change the harness measured "without" only once, before "with", and had no check that the overlay drew.

The synthetic overview case of the same spec (81,225 squares at 1 px across) ran in the same runs.

## Results

Real nuclei, two runs, 120 frames each, 0 errors:

| Run | Median with overlay (p95) | Median without, before | Median without, after | Overlay share | Pixels the overlay changed | Layers drawn | Budget | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 1.23 ms (2.67) | 0.79 ms | 1.31 ms | 0.43 ms | 1,808,752 | density raster, 333 large shapes outlined | 1 ms | within |
| 2 | 1.37 ms (2.67) | 1.31 ms | 1.31 ms | 0.05 ms | 1,808,752 | density raster, 333 large shapes outlined | 1 ms | within |

Building the polygon batch from the file took 95 and 90 ms on the main thread.

Synthetic grid, 81,225 squares, density tier, three runs:

| Run | Median with overlay | Median without, before | Median without, after | Overlay share | Pixels the overlay changed |
| --- | --- | --- | --- | --- | --- |
| A | 0.62 ms | 1.12 ms | 1.12 ms | -0.50 ms | 44,044 |
| B | 1.15 ms | 1.12 ms | 0.62 ms | 0.53 ms | 44,044 |
| C | 0.62 ms | 1.12 ms | 1.12 ms | -0.50 ms | 44,044 |

## Interpretation

The overlay at overview costs at most 0.43 ms of GPU time a frame with the real nuclei, within the 1 ms budget in both runs, and it draws: the density raster and the 333 shapes above the large size change 1.8M of the 5.2M canvas pixels.

The frame medians fall on a few levels, about 0.62, 1.12, 1.31 and 1.60 ms, with and without the overlay alike, and the same case moves between levels from run to run. That looks like the GPU's clock states, not overlay work, so differences under about half a millisecond are within what this method can resolve. The synthetic case even ran faster with its overlay in two runs. The budget still holds by the bound: in every run the whole frame with the overlay, slide tiles included, has a median of 1.37 ms or less, and the overlay's share by either baseline is 0.53 ms or less.

The POC found that drawing these 81,278 nuclei as filled polygons cost 9 to 19 ms of GPU time a frame before its level of detail change (POC doc 27). That is a POC number, not a measurement of this code.
