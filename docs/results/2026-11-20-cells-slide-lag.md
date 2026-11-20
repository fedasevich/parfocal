# Lag on a cells slide with 4392 AI outlines

Measured on 2026-11-20 on app.parfocal.eu at v0.29.1 for backlog task PROTO-128 (the AI cell outlines move with the camera without being redrawn), signed in as the agent test account. The slide is Philips-3.tiff in the project Scanner format comparison, opened from an annotate task with `object=T1+`. It opens the plain viewer with the Objects panel, not the cells or guided mode.

## What the slide holds

- The result set Cell typer v1 holds 4393 objects, and the AI layer draws 4392 of them as SVG polygons with 60426 vertices in all.
- The Objects panel lists 4408 rows at once, one per AI object and drawn object.
- The page holds 44559 DOM elements, 13227 of them SVG shapes.
- The first 15 seconds sent 260 requests. Ten idle seconds after that sent none and changed nothing in the DOM, so there is no polling loop, refetch storm or render loop at rest.

## Cause

`apps/web/src/annotations/ai-layer.tsx` subscribed to the camera and on every camera change projected every vertex of every outline to screen pixels, built a new `points` string for each of the 4392 polygons and had React rewrite all of them. A wheel step or a pan frame therefore cost about 60 ms of main thread work. The polygons now keep their slide coordinates and sit in one group whose `transform` follows the camera, with a stroke that does not scale, so a camera change writes one attribute.

## Before and after

Headless Chromium at 1440 by 900, 20 wheel steps and 20 arrow key pans over about 4 seconds. Before is the deployed v0.29.1 bundle. After is this branch built for production and served in place of the deployed assets against the same API and data.

| Run | Long tasks | Long task time | Longest task | Frame p50 | Frame p95 | Longest frame |
| --- | --- | --- | --- | --- | --- | --- |
| Before, run 1 | 28 | 1814 ms | 108 ms | 33 ms | 67 ms | 100 ms |
| Before, run 2 | 26 | 1614 ms | 111 ms | 33 ms | 67 ms | 117 ms |
| Before, run 3 | 24 | 1552 ms | 100 ms | 33 ms | 83 ms | 100 ms |
| After, run 1 | 2 | 108 ms | 57 ms | 17 ms | 33 ms | 50 ms |
| After, run 2 | 1 | 50 ms | 50 ms | 17 ms | 50 ms | 50 ms |
| After, run 3 | 1 | 51 ms | 51 ms | 17 ms | 33 ms | 50 ms |

## Tile decode

The owner's performance overlay showed a decode p95 of 870.4 ms. The pool in `packages/viewer-engine/src/decode/decode-pool.ts` times a tile from dispatch to settle, and the workers ask the main thread for their bytes through `byte-relay.ts`, so that number holds the range request to the tile store and any wait on a busy main thread. The range requests for `original.tiff` took a p50 of 232 to 348 ms and a p95 of 347 to 822 ms across the four runs, with no clear change from the fix. The decode p95 itself after the fix was not measured, because the overlay needs developer mode on the account. TODO.

## Not done here

- The Objects panel still renders all 4408 rows. It does not rerender on camera moves, but it adds most of the 44559 elements and part of the 1135 ms of long tasks while the slide opens.
- The outlines are all still painted on every frame. Culling to the view is not done.
