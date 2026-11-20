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

## Floating parts of the stage

Written for backlog tasks PROTO-131 (every floating part of the viewer stage has a home zone) and PROTO-129 (the overview map marker follows the camera), after the owner saw the overview map floating over tissue on this slide.

### What was measured on the deployed app

Signed in as the agent test account on app.parfocal.eu, Chrome, on the same slide and task.

- At 1512 by 982 the stage is 1120 by 938 px. After the 40× preset and then the 20× preset (⌥6 then ⌥4) the full size overview map sat at 904, 692 instead of its bottom right home at 952, 755, which is 48 px left and 63 px up. Nothing brings it back, so each switch between sizes can push the map further toward the middle.
- Cause: `useDrawnExtra` in `apps/web/src/viewer/stage-minimap.tsx` measured the drawn map against the size planned one render earlier, so the switch from compact to full counted the whole difference, 46 by 60 px rounded up to 48 by 64, as padding the map needs, and that padding only ever grew. The map now measures itself against the size it is drawn at, read from its own `data-size`, and keeps the padding per size.
- The marker did not go wrong. At 1512 by 982, 1470 by 956, 1280 by 800 and 1024 by 700, after wheel zoom, after the preset keys, after `object=C2` and with the map pinned top left, the marker centre matched the camera centre to three decimals. `object=T1+` names no object this account sees, so it opens the whole slide. Not tried: the developer drawer open, a narrow or wide side panel, and Safari. The marker check compares with the engine camera, so a camera that disagrees with the picture would not show. TODO.

### Home zones

| Part | Home zone | How it stays clear |
| --- | --- | --- |
| Tool rail | Left column outside the stage. In the dock layout, bottom centre inside the stage | The dock layout lifts the magnification bar above it |
| Top stack: context bar, GPU wait, open failure alert | Top centre, one column in that order | One stack, so they never meet. The map treats it as a block |
| Viewer banner for save and change notices | Full width band at the top edge | The map treats it as a block |
| Magnification bar with zoom presets and scale bar | Bottom centre | The map treats it as a block |
| Hint bar for slow tiles | Bottom centre, above the magnification bar | The map treats it as a block |
| Overview map | A corner, bottom right first, then bottom left, top right and top left, 12 px from both edges | Skips any corner holding a block and prefers corners clear of the selected or focused object. A pinned map keeps its corner unless it is blocked. Too small a stage draws it as the small picture or hides it |
| Object focus card in focus mode | Bottom right | The map treats it as a block |
| Coach bubbles | The first beside the object, the second bottom left | The map treats them as blocks |
| Tooltips | Next to their control, in a portal above the page | Close on wheel, on pointer down and when the pointer leaves the stage |
| Error toasts | Bottom right of the window, over the side panel | Outside the stage while the side panel is open. With the panel hidden they can sit over the map. TODO |
| Undo toasts | Bottom centre of the window | Short lived. They can sit over the magnification bar for a few seconds. TODO |
| Compare pane | Its own column beside the stage, with its pill top centre of that pane | A separate pane, never over the main stage |
| Developer drawer and performance overlay | Over the right side panel | Outside the stage |
| Guided parts: pan hint, guided controls, cell type bar, cells grid, whole slide button, travel map | Top left, bottom left and the edges the earlier overlap spec fixed | The map treats them as blocks |

### Tests

`apps/web/e2e/stage-parts-overlap.spec.ts` opens the annotate task slide with `object=C3` and the default Minimap setting at 1024 by 700, 1280 by 800 and 1440 by 900. Right after the focus and after four wheel steps in, it fails if any floating part covers C3. After six more steps in and three out it fails if any two floating parts meet, if any part leaves the stage or meets the side panel, or if the map is more than 8 px off its corner. The fake slide never reaches the full map size, so the spec passed before the drift fix as well. The drift is shown only by the deployed run above.
