# Result: the Viv route draws 1.6M nuclei at detail zoom in 1.60 ms a frame, and a route test covers the cull path

- Date: 2026-11-17
- Backlog: VIEW-029 (cull grid for overlays)
- Kind: benchmark
- Commit: 0ca625b2 with the harness and test changes of this result on top
- Environment: MacBook with Apple M4 (24 GB), Darwin 24.6.0, Chrome 157 headed (`channel: "chrome"`), WebGL2 on ANGLE Metal, canvas 2880 by 1800 at a pixel ratio of 2, one worker, one browser at a time, one-minute load averages of 4.0 to 5.1 while other agents ran. The route test ran headless on SwiftShader. Nothing ran on the Linux CI runner.
- Data: 1,600,225 synthetic squares of side 6 at a pitch of 20 on `synthetic-zlib.ome.tiff` (1024 by 768). No PHI.

## Question

Is the Viv route's GPU time at detail zoom with 1.6M nuclei under 6 ms a frame on the owner's Mac, and does a test drive the cull path through the route itself?

## Method

GPU time: `nice -n 10 pnpm exec playwright test -c playwright.gpu.config.ts --workers=1 gpu-bench/gpu-timing.spec.ts` in `packages/viewer-engine`, three runs. The case is the one the [2026-11-14 cull grid result](2026-11-14-overlay-cull-grid.md) describes: nuclei 20 CSS pixels across (2.357 pixels per slide unit, the outline tier), 20 warm-up and 120 measured frames, each a forced `deck.redraw` timed with `EXT_disjoint_timer_query_webgl2`. The harness now also measures the frame without the overlay a second time after the overlay is removed, records how many shapes each overlay layer hands to deck.gl and counts the canvas pixels the overlay changes. The spec fails if that count is 0, as the custom WebGPU route's spec already did in VIEW-073 (finish the custom WebGPU route).

Route test: `browser/overlay-cull.spec.ts` with its page `browser/page/overlay-cull-harness.ts`, run with `nice -n 10 pnpm exec playwright test --workers=1 overlay-cull`. It mounts the real Viv route on `synthetic-zlib.ome.tiff`, sets 160,000 squares at the outline tier and reads the nuclei layers from the route's deck. It asserts that the outlines draw, that every square touching the view is in the drawn data, that fewer than a twentieth of the squares are drawn, and that after a pan of one view width the drawn set is a different window that again holds every square in view.

## Results

GPU time at detail zoom, 1,600,225 nuclei, 0 errors in every run:

| Run | Median with overlay | 95th percentile | Least and most | Median without, before | Median without, after | Shapes per layer handed to deck.gl | Pixels the overlay changed | Budget | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 1.60 ms | 4.04 ms | 1.38 and 5.16 ms | 0.87 ms | 2.03 ms | 3,672 fills, casings and outlines | 603,710 | 6 ms | within |
| B | 1.60 ms | 2.06 ms | 1.38 and 2.13 ms | 2.03 ms | 2.03 ms | 3,672 | 603,710 | 6 ms | within |
| C | 1.60 ms | 2.06 ms | 1.38 and 2.98 ms | 0.88 ms | 0.87 ms | 3,672 | 603,710 | 6 ms | within |

Building the polygon batch took 277, 288 and 282 ms on the main thread. A run before the harness change gave 1.61 ms for the same case.

Route test, one run on SwiftShader, passed:

| View | Squares in the layer | Squares drawn | Squares touching the view | Touching but not drawn |
| --- | --- | --- | --- | --- |
| centre | 160,000 | 2,928 | 405 | 0 |
| one view width to the right | 160,000 | 2,928 | 405 | 0 |

## Interpretation

The detail frame takes 1.60 ms in all three runs, about a quarter of its 6 ms budget, with the cull window handing deck.gl 3,672 of 1.6M shapes, 0.23% of the layer. The frame medians sit on a few levels (0.87, 1.60, 2.03 ms) with and without the overlay, which looks like the GPU's clock states, so the overlay's own share (0.73 ms against the lower baseline) is only resolved to about half a millisecond. The frame with the overlay is the budgeted number and it is well under.

The slide behind the overlay is the small synthetic one, so a real slide adds its tile cost on top. The custom WebGPU route measured 1.96 ms for the same case ([2026-11-17 result](2026-11-17-custom-webgpu-route-culling-and-detail-tiers.md)), on a different API and timer, so the two are not a like-for-like comparison.

The route test closes the gap the 2026-11-14 result named: the path from a camera move through `cameraViewRect` to a new window is now checked on the real route, and the window holds every shape in view after a pan.
