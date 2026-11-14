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

## Decision

The test asserts the longest main-thread task, and it now passes. The app draws the stream through the same overlay builder (`engine.registerOverlay`). Frame gaps on real GPU hardware are TODO and belong in a `gpu-bench` run.
