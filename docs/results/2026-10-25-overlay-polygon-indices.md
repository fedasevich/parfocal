# Result: precomputed triangle indices against deck.gl's own triangulation

- Date: 2026-10-25
- Backlog: VIEW-026 (overlay layer system), closes the polygon indices item of VIEW-030 (memory and teardown correctness)
- Kind: benchmark
- Commit: adc94fc with the VIEW-026 (overlay layer system) changes on top, not yet committed
- Environment: MacBook with Apple M4 (24 GB), macOS 15.8.1 (Darwin 24.6.0), Node 26.9.0, Google Chrome 155.0.8059.86 driven headless by `@playwright/test` 1.64.0 with `channel: "chrome"` and the SwiftShader flags of `packages/golden-images/src/playwright.ts`. deck.gl 9.4.0, luma.gl 9.4.2, `@math.gl/polygon` 4.1.0
- Data: synthetic octagons on a square grid, one irregular radius and rotation each, with a distinct colour each. No slide and no patient data

## Question

POC doc 24 measured that handing precomputed triangle indices to `SolidPolygonLayer` took a layer update of 1M polygons from 394 ms to 87 ms, and that the picture differed on under 0.04% of sampled pixels. Does the same hold in this repository, with deck.gl 9.4 and the indices built by `createPolygonBatch` in `src/overlay/batches.ts`?

## Method

The spec is `packages/viewer-engine/browser/overlay-indices.spec.ts` and the page is `browser/page/overlay-indices-harness.ts`. Run it with `pnpm --filter @parfocal/viewer-engine exec playwright test browser/overlay-indices.spec.ts`.

For each size the page builds a `PolygonBatch` of that many octagons, which runs earcut once and is timed as "batch". It then creates a `Deck` with no layers, waits for its first frame, and sets one `SolidPolygonLayer` over a 256 × 256 canvas at a device pixel ratio of 1. The camera is zoomed so that one grid cell is 16 pixels wide.

- "Precomputed" passes the batch's `indices` as `data.attributes.indices`, with `_normalize: false`.
- "Deck" passes the same data without `indices` and with `_normalize: false`, so deck.gl triangulates every polygon with its own earcut in `updateState`.

"Update" is the summed time of `SolidPolygonLayer.prototype.updateState`, wrapped in the page, between `setProps` and the first frame. "Frame" is the time from `setProps` to the next `onAfterRender`, which includes drawing on SwiftShader. Each size runs 5 times (3 times at 1M), alternating the two modes, each run in a freshly loaded page. The two frames of the last run are compared pixel by pixel with no tolerance.

## Results

Times in milliseconds, median of the runs, with the individual runs in brackets.

| Polygons | Batch (earcut, once) | Update, precomputed | Update, deck | Frame, precomputed | Frame, deck | Differing pixels |
|---|---|---|---|---|---|---|
| 20,000 | 8 (8, 8, 8, 9, 7) | 3 (53, 3, 3, 17, 3) | 12 (12, 12, 9, 9, 15) | 19 (78, 12, 13, 22, 19) | 19 (15, 21, 17, 26, 19) | 0 |
| 100,000 | 29 (31, 31, 29, 25, 25) | 8 (12, 9, 8, 8, 8) | 28 (28, 27, 28, 28, 44) | 15 (22, 16, 15, 14, 14) | 34 (34, 35, 34, 34, 51) | 0 |
| 1,000,000 | 273 (249, 273, 281) | 39 (34, 39, 39) | 261 (236, 261, 278) | 74 (66, 74, 92) | 297 (276, 297, 320) | 0 |

The maximum channel difference between the precomputed and the deck frame was 0 at every size.

## Interpretation

- A layer update with precomputed indices took 3 to 39 ms against 12 to 261 ms, which is 3.5 to 7 times less. At 1M polygons that is 261 ms against 39 ms, the same shape as the POC's 394 ms against 87 ms on its own machine and deck.gl version.
- The batch costs about what deck.gl's own triangulation costs (273 ms against 261 ms at 1M), so the saving comes from paying it once. Every later update of the layer, such as a new `data` object after `invalidate`, skips it. Visibility and opacity changes never update the layer's data at all.
- The first run at each size is slower than the rest (53 ms update and 78 ms frame at 20,000 polygons), which is JIT and shader warm-up. The medians ignore it. At 20,000 polygons the frame times are equal (19 ms), because drawing outweighs the 9 ms saved.
- The pictures are identical here, with 0 differing pixels at every size, against the POC's under 0.04% on sampled pixels. The test polygons are about 11 to 14 px wide. Sub-pixel polygons were not tested.
- An early run of the `deck` mode with `_normalize: true` and per-vertex colour attributes differed from the precomputed frame on 3.1% of the pixels, with a maximum channel difference of 235. The likely cause is that normalizing adds a closing vertex to each ring while the colour attribute keeps the original count. That is an assumption, not checked in deck.gl's code. The `deck` mode therefore uses `_normalize: false`, which makes deck.gl triangulate the buffer as it is.
- Timings come from one machine, SwiftShader and a synthetic grid, so they are a comparison between the two modes, not a budget. Only the 1M row asserts that precomputed is faster. The other rows assert the pictures match.

## Follow-ups

- [ADR 0108](../adr/0108-overlay-layers-as-typed-data-over-deck-gl.md) records the overlay design that uses the batch.
- TODO: a batch of 1M polygons takes 273 ms on the page's main thread, so a large result set should triangulate in a worker or on the server. That belongs to the nucleus result loading tasks, not to this one.
