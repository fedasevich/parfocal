# Result: cell row culling and the level of detail tiers on the custom WebGPU route

- Date: 2026-11-17
- Backlog: VIEW-073 (finish the custom WebGPU route)
- Kind: check
- Commit: 6d723566 (cell row culling and the density and dot tiers)
- Environment: 24 GB Mac, Darwin 24.6.0. Goldens in Playwright headless Chrome (`channel: "chrome"`) on SwiftShader, one worker. GPU timing headed on the Mac's own GPU, Chrome 157, WebGPU, canvas 2880 by 1800 at a pixel ratio of 2, one worker, with a 1-minute load of 5.57 before and 5.45 after while other agents ran. Nothing was run on the Linux CI runner.
- Data: `CMU-1.svs` from the fixture cache for the goldens and `synthetic-zlib.ome.tiff` for the timing (public and synthetic, no PHI)

## Question

With the small shapes of a large set ordered by cell and drawn by visible cell row, and with the density and dot tiers of the Viv route, does the custom WebGPU route draw 1.6M nuclei at detail zoom within 6 ms a frame and 81k nuclei at overview within 1 ms of overlay time, the budgets of VIEW-029 (cull grid for overlays)? Do the route's goldens keep their numbers?

## Method

Goldens: `PARFOCAL_E2E_PORT=5196 pnpm exec playwright test --workers=1 routes-cmu1 -g "custom-webgpu"` in `packages/golden-images`, one run.

GPU timing: `PARFOCAL_GPU=hardware pnpm exec playwright test -c playwright.gpu.config.ts --workers=1 custom-gpu-timing` in `packages/viewer-engine`, one run, the same harness and cases as the [2026-11-15 result](2026-11-15-custom-webgpu-route-labels-translucent-outlines-and-device-loss.md): a grid of square nuclei of side 6 at a pitch of 20 slide units, 10 warm-up frames and 60 measured frames, with and without the overlay, timing the render pass with `timestamp-query`. At 0.118 pixels per slide unit a nucleus is about 1 pixel across, which is the density tier. At 2.357 it is about 20 pixels, which is the outline tier with culling.

`node --test test/custom-webgpu/culled-sets.test.ts test/custom-webgpu/custom-webgpu.test.ts` covers the shape instance offsets against the instance builder, the cell order, the ranges at each tier and that every shape touching the view is drawn.

## Results

GPU time of the render pass, 60 frames each, 0 errors and 0 uncaptured GPU errors:

| Case | Nuclei | Pixels per slide unit | Tier | Median with overlay | 95th percentile | Least and most | Median without overlay | Overlay share | Budget | Outcome | Before (2026-11-15) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| overview | 81,225 | 0.118 | density | 0.75 ms | 0.82 ms | 0.43 and 0.89 ms | 0.73 ms | 0.02 ms | 1 ms of overlay time | within | 21.12 ms overlay share |
| detail zoom | 1,600,225 | 2.357 | outlines, culled | 2.05 ms | 2.13 ms | 1.96 and 2.14 ms | 0.88 ms | 1.17 ms | 6 ms a frame | within | 114.82 ms a frame |

The harness built the polygon batches in 30 ms and 285 ms on the main thread. The time the route takes to order a set, build its cull grid and its density raster when the set is sent was not measured on its own.

Goldens on the `custom-webgpu` route, all 13 passed:

| Test | Pixels differing by more than 4 | Largest channel delta | Mean error R, G, B |
| --- | --- | --- | --- |
| translucent outlines | 0.063% | 174, 166, 209 | 0.067, 0.054, 0.055 |
| coverage | 0.000% | 0, 0, 0 | 0.000, 0.000, 0.000 |
| heatmap | 0.000% | 0, 0, 0 | 0.000, 0.000, 0.000 |
| nuclei | 0.049% | 240, 225, 241 | 0.093, 0.076, 0.072 |
| ai-proposals | 0.078% | 244, 244, 244 | 0.053, 0.078, 0.051 |
| human-annotations | 0.008% | 225, 207, 213 | 0.013, 0.010, 0.013 |
| measurements | 0.009% | 244, 244, 244 | 0.020, 0.019, 0.020 |
| id-labels, against the Viv frame of the same browser | 0.000% | 1, 1, 1 | 0.002, 0.002, 0.002 |
| comment-pins | 0.000% | 1, 1, 1 | 0.000, 0.000, 0.001 |

The three slide goldens (fit, 10x and 40x) matched and the lost device test recovered twice. These are the numbers of 2026-11-15.

## Interpretation

Both budgets are met with room: the detail frame takes about a third of its 6 ms, and the density raster at overview costs almost nothing over the slide. The gap from 114.82 ms is far larger than the load of a shared machine can explain, but each case is one run.

The golden sets have fewer than 500 shapes, so they do not engage the tiers and are drawn exactly as before, which is why their numbers did not move. No golden image covers the density or dot tier or a culled set on this route, and the order of small shapes inside a culled set is by cell, not the original order the Viv route keeps.

## Follow-ups

TODO: a golden of a set with 500 or more shapes at each tier on both routes, which would also show whether the cell order of a culled set is visible.
