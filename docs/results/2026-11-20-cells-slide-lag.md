# Lag on a cells slide with 4392 AI outlines

Measured on 2026-11-20 on app.parfocal.eu at v0.29.1 for backlog task PROTO-128 (the AI cell outlines move with the camera without being redrawn), signed in as the agent test account. The slide is Philips-3.tiff in the project Scanner format comparison, opened from an annotate task with `object=T1+`. It opens the plain viewer with the Objects panel, not the cells or guided mode, and the first view shows the whole slide at 0.35×.

## What the slide holds

- The result set Cell typer v1 holds 4393 objects, and the AI layer draws 4392 of them as SVG polygons with 60426 vertices in all.
- The Objects panel lists 4408 rows at once, one per AI object and drawn object.
- The page holds 44559 DOM elements, 13227 of them SVG shapes.
- A 35 second run, open, idle, pan and settle, sent 260 requests. Ten idle seconds 15 seconds after the open sent none and changed nothing in the DOM, so there is no polling loop, refetch storm or render loop at rest.

## Cause

`apps/web/src/annotations/ai-layer.tsx` subscribed to the camera and on every camera change projected every vertex of every outline to screen pixels, built a new `points` string for each of the 4392 polygons and had React rewrite all of them. A wheel step or a pan frame cost about 60 ms of main thread work.

The polygons now keep their slide coordinates and sit in one group whose `transform` follows the camera, with a stroke that does not scale, so a camera change writes one attribute. With the transform alone, a deep zoom near 1× still showed one or two tasks of about 530 ms in each of four runs, so the layer also keeps an area three views wide around the view. When fewer than a quarter of the outlines fall in that area, the full set is hidden with one `display` attribute and only the outlines in the area are drawn. The area moves only when the view leaves it, so nothing is mounted or unmounted on most camera moves.

## Before and after

Headless Chromium at 1440 by 900, 20 wheel steps and 20 arrow key pans over 3 to 6 seconds. Before is the deployed v0.29.1 bundle. After is this branch built for production and served in place of the deployed assets against the same API and data. The open runs start from the first view at 0.35×. The deep runs first zoom in 30 wheel steps, to about 1.2×. The runs were interleaved, before then after, while other agents loaded the machine to a load average of 10 to 13.

| Run | Polygon `points` writes | Long tasks | Long task time | Longest task | Frame p50 | Frame p95 | Longest frame |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Before, open, run 1 | 417240 | 42 | 3151 ms | 109 ms | 50 ms | 100 ms | 117 ms |
| After, open, run 1 | 0 | 0 | 0 ms | 0 ms | 17 ms | 33 ms | 50 ms |
| Before, deep, run 1 | 360144 | 9 | 660 ms | 93 ms | 33 ms | 67 ms | 100 ms |
| After, deep, run 1 | 0 | 0 | 0 ms | 0 ms | 17 ms | 33 ms | 33 ms |
| Before, open, run 2 | 404064 | 54 | 4150 ms | 150 ms | 50 ms | 117 ms | 150 ms |
| After, open, run 2 | 0 | 0 | 0 ms | 0 ms | 17 ms | 33 ms | 50 ms |
| Before, deep, run 2 | 412848 | 13 | 826 ms | 89 ms | 33 ms | 67 ms | 100 ms |
| After, deep, run 2 | 0 | 0 | 0 ms | 0 ms | 17 ms | 17 ms | 33 ms |

Earlier runs on a quieter machine gave 24 to 28 long tasks and 1552 to 1814 ms for the deployed bundle in the open runs.

## Tile decode

The owner's performance overlay showed 60 frames a second and a decode p95 of 870.4 ms on the Viv route. The slide is a Philips TIFF with JPEG tiles, decoded in six `decode.worker` workers. The tile size was not checked. The pool in `packages/viewer-engine/src/decode/decode-pool.ts` times a tile from dispatch to settle, and the decode workers ask the main thread for their bytes through `relayFetch` in `byte-relay.ts`, so that number holds the range request to the tile store and any wait on a busy main thread. The range requests for `original.tiff` took a p50 of 136 to 797 ms and a p95 of 347 to 1419 ms across the runs, with no clear change from the fix. The decode p95 itself after the fix was not measured, because the overlay needs developer mode on the shared test account. TODO.

## Not done here

- The Objects panel still renders all 4408 rows. It does not rerender on camera moves, but it adds most of the 44559 elements and part of the 1135 ms of long tasks while the slide opens.
- Tile range latency to the tile store is a second, open cause of the slow feel.
