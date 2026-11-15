# Result: streaming 250,000 nuclei keeps every main-thread task under 33 ms

- Date: 2026-11-15
- Backlog: AINUC-013 (stream a whole-slide run onto the open slide)
- Kind: check
- Commit: the AINUC-013 change on its branch
- Environment: Apple Mac shared with four other agents, Playwright with Google Chrome headless and SwiftShader, 512 x 512 deck.gl canvas. A Node HTTP server on loopback serves a simulated run: 64 tiles, one more finished every 120 ms, polled every 250 ms
- Data: synthetic, no PHI. 250,000 cells with 19 vertices each from `packages/viewer-engine/test/nuclei/synthetic.ts`, in 2048 px tiles of about 3,900 cells

## Question

Does `browser/nuclei-stream.spec.ts` stream 250,000 nuclei with no frame over 33 ms? The longest main-thread task comes from a Chrome trace, the same way `wheel-zoom.spec.ts` measures it. Frame gaps from `requestAnimationFrame` are recorded for information only.

## Numbers

| Version | Longest main-thread task | Cause |
| --- | --- | --- |
| Each block drawn as a plain `SolidPolygonLayer` | 2,886 ms | SwiftShader drew every outline at overview zoom, and the frame commit waited for it |
| Drawn through the engine's overlay builder with level of detail, blocks filled in arrival order | 65 ms | Every seventh block spanned the end of one tile row and the start of the next, so its density raster and cull grid covered two whole rows. Building it took 51 to 55 ms, while other blocks took about 6 ms |
| Blocks split when a tile lies far from the open block, 8,192 polygons each | 22.4 ms | The longest layer build was 11.6 ms |

In the final run, the longest `requestAnimationFrame` gap was 150 ms, and 11 of 479 frames had gaps over 33 ms. Those gaps come from SwiftShader rasterising in the GPU process, not from page work.

## On the real GPU

`playwright.stream-gpu.config.ts` runs the same spec headed in Chrome on the Mac's own GPU, with the 1-minute load between 15 and 23.

| Run | Longest main-thread task | Longest frame gap | Gaps over 33 ms | Frames |
| --- | --- | --- | --- | --- |
| Cold page, no shader warm-up | 60.6 ms | 68.4 ms | 1 | 479 |
| Cold page, nuclei shaders warmed when the slide opens | 16.0 ms | 18.6 ms | 0 | 480 |

Without the warm-up, the only long frame ends 70 ms after the first draw. It is the frame where WebGL first links the programs of the nuclei layers, a one-time cost per page that does not grow with the run. Our layer build peaked at 12.0 ms.

`src/overlay/deck/shader-warmup.ts` builds a nuclei overlay of 600 transparent squares a million pixels off the slide at the outline, dot and density levels of detail. The Viv route draws those layers for one frame once the open slide first settles and then drops them, so the cost lands just after slide open instead of during a run. Waiting for the slide to settle keeps the warm-up out of a slide that is still loading, which the late-tile hint test in `viv-loading.spec.ts` showed. The harness has no route, so it draws the same layers once when its canvas opens, and `STREAM_COLD=1` skips it to reproduce the first row. In the software-GL run with the warm-up, the longest main-thread task was 16.0 ms.

## Decision

The SwiftShader test asserts the longest main-thread task, and the real-GPU run shows no frame gap over 33 ms. The app draws the stream through the same overlay builder (`engine.registerOverlay`), and the Viv route warms the nuclei shaders whenever a slide opens.
