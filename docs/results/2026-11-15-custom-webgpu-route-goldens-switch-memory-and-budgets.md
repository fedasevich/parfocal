# Result: custom WebGPU route against the Viv goldens, route switch memory across three routes, and the viewer budgets

- Date: 2026-11-15
- Backlog: VIEW-038 (custom WebGPU engine route)
- Kind: baseline
- Commit: the VIEW-038 commit that adds this file
- Environment: 24 GB Mac, Darwin 24.6.0, Playwright headless Chrome (`channel: "chrome"`), WebGL on ANGLE Vulkan SwiftShader, WebGPU on the SwiftShader adapter (`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --use-vulkan=swiftshader --enable-features=Vulkan`), one Playwright worker, no network shaping except where an RTT is named. Four other agents ran on the same machine, and the 1-minute load was 76 when it was read once during the budget run. It was not held down for any run.
- Data: `CMU-1.svs`, `CMU-1-Small-Region.svs`, `CMU-1-JP2K-33005.svs` and `CMU-1.tiff` from the fixture cache (public test slides, no PHI)

## Question

Does the custom WebGPU route, which draws from a render worker on an `OffscreenCanvas`, draw the same frames as Viv within the tolerances of the Viv goldens, with zero uncaptured GPU errors? Does switching across all three routes keep one canvas and the heap within 10% ([ADR 0103](../adr/0103-memory-settings-and-test-baseline.md), memory settings and test baseline)? Do the pan and budget specs pass their existing budgets on this route?

## Method

`PARFOCAL_E2E_PORT=5209 pnpm exec playwright test --workers=1 routes-cmu1 -g "on the custom-webgpu"` in `packages/golden-images`, and `pnpm exec playwright test --workers=1 route-switch` and `PARFOCAL_RENDERER_ROUTE=custom-webgpu pnpm exec playwright test --workers=1 pan.spec budgets.spec` in `packages/viewer-engine`. The golden spec is the one the deck.gl WebGPU route uses: a canvas screenshot against the PNG that Viv produced, overlay kinds at the overlay tolerance (channel delta 4, 0.1% of pixels, mean error 0.5), and the route's error list and uncaptured GPU error count asserted empty and zero. Each table is one run.

## Results

Slide frames on the `custom-webgpu` route, all with 0 uncaptured GPU errors and no reported error:

| Scene | Outcome against the Viv golden |
| --- | --- |
| `viv-cmu-1-svs-fit` | matched |
| `viv-cmu-1-svs-10x` | matched |
| `viv-cmu-1-svs-40x` | matched |

Overlay kinds on the `custom-webgpu` route, all with 0 uncaptured GPU errors:

| Kind | Pixels differing by more than 4 | Largest channel delta | Mean error R, G, B | Reference | Test bound | Outcome |
| --- | --- | --- | --- | --- | --- | --- |
| coverage | 0.000% | 0 | 0.000, 0.000, 0.000 | Viv golden | 0.1% | passed |
| heatmap | 0.000% | 0 | 0.000, 0.000, 0.000 | Viv golden | 0.1% | passed |
| nuclei | 0.049% | 241 | 0.093, 0.076, 0.072 | Viv golden | 0.1% | passed |
| ai-proposals | 0.078% | 244 | 0.053, 0.078, 0.051 | Viv golden | 0.1% | passed |
| human-annotations | 0.008% | 225 | 0.013, 0.010, 0.013 | Viv golden | 0.1% | passed |
| measurements | 0.009% | 244 | 0.020, 0.019, 0.020 | Viv golden | 0.1% | passed |
| id-labels | not drawn | | | Viv frame, same browser | 0.1% | skipped, the route reports the layer as left out |
| comment-pins | 0.000% | 1 | 0.000, 0.000, 0.001 | Viv golden | 0.1% | passed |

Two earlier states of the outline drawing, same command:

| State | nuclei | ai-proposals | human-annotations | measurements |
| --- | --- | --- | --- | --- |
| One rectangle per segment that reaches half a line width past both ends, dash as a hard cut | 0.093% | 0.417% | 0.013% | 0.017% |
| The same with deck.gl's dash coverage integral | 0.093% | 0.137% | not run | not run |
| Body rectangle between the two points and a separate round cap at the start (committed) | 0.049% | 0.078% | 0.008% | 0.009% |

Route switch memory, 15 switches over `viv`, `deck-webgpu` and `custom-webgpu` with a five-switch warm-up, two runs of the committed route code:

| Run | Heap after a switch to Viv | to deck.gl WebGPU | to custom WebGPU | Decks on custom WebGPU | Canvases per round | Uncaptured GPU errors | Switch time to custom WebGPU | to deck.gl WebGPU | to Viv |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 8.0 to 8.5 MB | 8.6 to 9.2 MB | 6.8 to 7.3 MB | 0 | 1 | 0 | 798 to 899 ms | 1006 to 1255 ms | 1067 to 1251 ms |
| 2 | 8.0 to 8.5 MB | 8.5 to 9.1 MB | 6.7 to 7.3 MB | 0 | 1 | 0 | 674 to 805 ms | 982 to 1394 ms | 1057 to 1508 ms |

Run 1 failed the test with 23.5% growth, because the test compared round 5 (custom WebGPU, 6.9 MB) with round 15 (Viv, 8.5 MB). Run 2 used the changed test, which compares round 6 with round 15, both on Viv, and passed with 4.2% growth. Both runs had 0 live decks and 0 canvases after dispose.

Pan and budget specs with `PARFOCAL_RENDERER_ROUTE=custom-webgpu`, all 15 tests passed their existing budgets:

| Slide | RTT | Fitted image, fastest of 3 | Sharp after a jump to 10x, fastest of 3 |
| --- | --- | --- | --- |
| `CMU-1.svs` | 0 ms | 979 ms, 8 requests | 625 ms, 13 requests |
| `CMU-1.svs` | 50 ms | 1639 ms, 8 requests | 1048 ms, 13 requests |
| `CMU-1.svs` | 100 ms | 2333 ms, 8 requests | 1706 ms, 13 requests |
| `CMU-1.svs` | 200 ms | 3738 ms, 8 requests | 2947 ms, 13 requests |
| `CMU-1-JP2K-33005.svs` | 0 ms | 750 ms, 4 requests | 493 ms, 7 requests |
| `CMU-1-JP2K-33005.svs` | 50 ms | 1221 ms, 4 requests | 714 ms, 7 requests |
| `CMU-1-JP2K-33005.svs` | 100 ms | 1992 ms, 4 requests | 1047 ms, 7 requests |
| `CMU-1-JP2K-33005.svs` | 200 ms | 3755 ms, 4 requests | 2564 ms, 7 requests |
| `CMU-1.tiff` | 0 ms | 1452 ms, 7 requests | 612 ms, 4 requests |
| `CMU-1.tiff` | 50 ms | 2249 ms, 7 requests | 932 ms, 4 requests |
| `CMU-1.tiff` | 100 ms | 2636 ms, 7 requests | 945 ms, 4 requests |
| `CMU-1.tiff` | 200 ms | 4089 ms, 7 requests | 1509 ms, 4 requests |

At 0 ms RTT the longest main thread task during the jump was 1.0 ms on `CMU-1.svs` and 0.9 ms on the other two slides.

| Pan run | Open | Outbound | Back | Duplicate bytes | Settle |
| --- | --- | --- | --- | --- | --- |
| six decode workers | 21 fetches | 27 fetches | 0 fetches | 0 B | 550 and 118 ms |
| page, shared bytes | 21 fetches | 27 fetches | 0 fetches | 0 B | 666 and 275 ms |
| page, geotiff direct | 21 fetches | 27 fetches | 0 fetches | 0 B | 1000 and 293 ms |

`node --test test/custom-webgpu/custom-webgpu.test.ts` passes. It asserts on a fake device that two updates of one annotation set make two `writeBuffer` calls and one buffer.

## Interpretation

The route draws slide pixels the Viv goldens accept, from a worker, with the same request counts as the deck.gl WebGPU route in its [result](2026-11-15-deck-webgpu-route-goldens-and-switch-memory.md) (8 and 13 on `CMU-1.svs`, and 21, 27 and 0 fetches on the pan), so the tile selection asks for the same tiles. Rasters and pins match to the pixel. Outlines match within the tolerance but not to the pixel, as they do on the deck.gl WebGPU route. The fixture puts vertices on pixel centres, so many line edges pass within about 0.01 pixel of a pixel centre, and which side wins depends on where the rasteriser snaps the corners of each triangle. Giving the body of a segment the same corners as deck.gl's (the two points, with no reach past them) halved the difference, which supports that reading. The joints are still separate squares here and mitred triangles in deck.gl, so the rest will not go away without drawing deck.gl's exact triangles.

ID labels are not drawn, so one of the eight overlay goldens does not pass on this route. The level of detail tiers and compute culling are not built either, and the goldens do not exercise them.

All of this is SwiftShader on one loaded Mac. The switch times and the fitted and sharp times say nothing about a real GPU, and the differences between routes in one run are within what the load can move.

## Follow-ups

[ADR XXXX](../adr/XXXX-custom-webgpu-route-draws-from-a-render-worker.md) (the custom WebGPU route draws from a render worker and keeps the Viv tile data path). TODO: ID labels on this route. TODO: the level of detail tiers on this route. TODO: a run on a real GPU, headed, with a large nuclei set, to decide on compute culling.
