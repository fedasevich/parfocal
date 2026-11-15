# Result: ID labels, translucent outlines, a lost device and a first GPU timing on the custom WebGPU route

- Date: 2026-11-15
- Backlog: VIEW-073 (finish the custom WebGPU route)
- Kind: check
- Commit: fec60325 (ID labels and the buffer size guard), d5008d90 (translucent outlines), and the device loss and GPU timing commits of the same task
- Environment: 24 GB Mac, Darwin 24.6.0, Playwright headless Chrome (`channel: "chrome"`), WebGL on ANGLE Vulkan SwiftShader, WebGPU on the SwiftShader adapter, one Playwright worker. Other agents ran on the same machine and the load was not read for these runs. The GPU timing alone ran headed on the Mac's own GPU (Apple M4, Chrome 157, WebGPU, canvas 2880 by 1800 at a pixel ratio of 2), with a 1-minute load of 24 before and 21 after. Nothing was run on the Linux CI runner.
- Data: `CMU-1.svs` from the fixture cache (public test slide, no PHI)

## Question

Do the ID labels and the translucent outlines on the custom WebGPU route match Viv within the overlay tolerance (channel delta 4, 0.1% of pixels, mean error 0.5)? Does the route redraw the same frame after its device is lost? How long does the GPU take for a frame with 81k and with 1.6M nuclei, before any culling or level of detail tier exists on this route, against the budgets of VIEW-029 (cull grid for overlays): 1 ms of overlay time at overview and 6 ms a frame at detail zoom?

## Method

`PARFOCAL_E2E_PORT=5214 pnpm exec playwright test --workers=1 routes-cmu1 -g "on the custom-webgpu"` in `packages/golden-images`, and the same command with `-g "a lost device on the custom-webgpu"`. ID labels are compared with the Viv frame of the same browser, as on the deck.gl WebGPU route, because glyphs depend on the platform font. Translucent outlines (nuclei and human annotations at opacity 0.5) are compared with the golden image that Viv drew. Each row is one run.

GPU timing: `PARFOCAL_GPU=hardware pnpm exec playwright test -c playwright.gpu.config.ts custom-gpu-timing` in `packages/viewer-engine`. The page opens `synthetic-zlib.ome.tiff` on the custom WebGPU route with `gpuTiming` on, which makes the render worker ask for the `timestamp-query` feature and write a timestamp at the start and the end of the render pass. It draws the same grid of four-vertex nuclei as the Viv timing harness, 10 warm-up frames and 60 measured frames with and without the overlay. The time is the render pass only, where the Viv harness times the whole frame with a WebGL timer query.

## Results

ID labels on the `custom-webgpu` route, three runs with the same numbers:

| Kind | Pixels differing by more than 4 | Largest channel delta | Mean error R, G, B | Reference | Outcome |
| --- | --- | --- | --- | --- | --- |
| id-labels | 0.000% | 1 | 0.002, 0.002, 0.002 | Viv frame, same browser | passed |

Translucent outlines against `viv-overlay-translucent-outlines`:

| Route and state | Pixels differing by more than 4 | Largest channel delta R, G, B | Mean error R, G, B | Outcome |
| --- | --- | --- | --- | --- |
| Viv | 0.000% | 0, 0, 0 | 0.000, 0.000, 0.000 | passed |
| deck.gl WebGPU | 0.000% | 1, 1, 1 | 0.000, 0.000, 0.000 | passed |
| custom WebGPU before this task | 1.297% | 185, 170, 185 | 0.408, 0.302, 0.315 | failed |
| custom WebGPU, a pixel takes each ring once | 0.795% | 174, 166, 176 | 0.291, 0.207, 0.217 | failed |
| the same, with the first edge of a closed ring drawn twice | 0.112% | 174, 166, 209 | 0.078, 0.064, 0.066 | failed |
| the same, with a cap at the end of the repeated edge and partly covered dash pixels not blocking later ones (committed) | 0.063% | 174, 166, 209 | 0.067, 0.054, 0.055 | passed |

The other overlay kinds after both changes, one run of all twelve custom WebGPU tests, all passed with 0 uncaptured GPU errors: coverage 0.000%, heatmap 0.000%, nuclei 0.049%, ai-proposals 0.078%, human-annotations 0.008%, measurements 0.009%, comment-pins 0.000%. These are the numbers of the [VIEW-038 result](2026-11-15-custom-webgpu-route-goldens-switch-memory-and-budgets.md) (custom WebGPU engine route), so the opaque path did not change. The three slide goldens matched.

Device loss, one run: the test draws heatmap, nuclei, ID labels and comment pins, destroys the device in the render worker twice, and after each loss the route reported 1 and then 2 recoveries, no error, 0 uncaptured GPU errors, the same layer list, and a frame within the overlay tolerance of the frame before the loss. The test took 33.8 s.

`node --test test/custom-webgpu/*.test.ts` passes 15 tests. They cover the glyph packing and label instances on a fake font, the ring id and the repeated first edge in the segment instances, and a set above the buffer limit being left out without a new buffer.

GPU time of the render pass on the Mac's GPU, one run, 60 frames each, 0 errors and 0 uncaptured GPU errors:

| Case | Nuclei | Pixels per slide unit | Median with overlay | 95th percentile | Least and most | Median without overlay | Overlay share | Budget | Outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| overview | 81,225 | 0.118 | 21.53 ms | 25.64 ms | 18.71 and 27.59 ms | 0.40 ms | 21.12 ms | 1 ms of overlay time | over |
| detail zoom | 1,600,225 | 2.357 | 114.82 ms | 116.83 ms | 110.01 and 117.53 ms | 0.70 ms | 114.12 ms | 6 ms a frame | over |

Building the polygon batch took 32 ms and 431 ms on the main thread. A run at smoke size before it (1,600 and 3,600 nuclei, 6 frames) gave 1.06 ms and 1.93 ms with the overlay.

## Interpretation

ID labels now match Viv to a channel delta of 1, so all eight overlay kinds pass on this route. The Viv golden for translucent outlines shows the first edge of every closed ring blended twice, which is how deck.gl's path layer draws a loop, and the route has to repeat that edge to match. With that, the remaining 0.063% is close to the sum of the opaque differences of the two kinds (0.049% and 0.008%), which are single pixels on line edges.

The loss test destroys the device on purpose. A loss that the browser causes was not produced, and neither was the fourth loss within 30 seconds, after which the route fails as before.

The timing answers the question [ADR 0326](../adr/0326-custom-webgpu-route-draws-from-a-render-worker.md) (the custom WebGPU route draws from a render worker) left open. Without culling and without tiers the route is 19 times over the detail budget and 21 times over the overview budget, so both have to be built. At detail zoom the GPU runs the vertex stage for every segment of 1.6M nuclei although few are on screen. At overview every nucleus is still drawn as four outline segments at least 1 pixel wide, where the Viv route draws a density raster. It is one run on a loaded machine, and the gap is far larger than load can explain.

Compute culling and the level of detail tiers are not built, so the last part of the task's "Done when" line is open.

## Follow-ups

TODO: the level of detail tiers and culling on this route, then the same timing again. The backlog text of VIEW-029 (cull grid for overlays) describes contiguous ranges per row of cells, so drawing only the instance ranges of the visible rows is worth trying before a compute pass. `src/overlay/cull-grid.ts` was not read for this task.
