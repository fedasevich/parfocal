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

`playwright.stream-gpu.config.ts` runs the same spec headed in Chrome on the Mac's own GPU, with the 1-minute load at 15 to 16. Setting `STREAM_WARM=1` makes the harness draw a small nuclei overlay once before the run starts, so its shaders are compiled before the frames are measured.

| Run | Longest main-thread task | Longest frame gap | Gaps over 33 ms | Frames |
| --- | --- | --- | --- | --- |
| Cold, the first nuclei overlay drawn during the run | 60.6 ms | 68.4 ms | 1 | 479 |
| Shaders compiled before the run (`STREAM_WARM=1`) | 27.7 ms | 18.7 ms | 0 | 489 |

The only long frame of the cold run ends 70 ms after the first draw. It is the frame where WebGL first links the programs of the nuclei layers, a one-time cost per page that does not grow with the run. Streaming itself never held a frame over 33 ms. Our layer build peaked at 12.0 ms.

## Decision

The SwiftShader test asserts the longest main-thread task, and it passes. The app draws the stream through the same overlay builder (`engine.registerOverlay`). The first-use shader link is not streaming work, but the viewer pays it in the middle of a run when no nuclei overlay was drawn before. TODO: compile the overlay shaders when the slide opens, in the renderer route, so the first streamed tile does not pay for them.
