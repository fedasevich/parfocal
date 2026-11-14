# Result: the overlay cull grid at 1.6M nuclei, CPU side only

- Date: 2026-11-14
- Backlog: VIEW-029 (cull grid for overlays)
- Kind: benchmark
- Commit: 835ec8fb with the VIEW-029 (cull grid for overlays) changes on top
- Environment: MacBook with Apple M4 (24 GB), macOS (Darwin 24.6.0), Node 26.13.0. No browser and no GPU took part
- Data: 1,600,225 synthetic squares of side 6 on a square grid of pitch 20 (1265 per row), one colour. No slide and no patient data

## Question

The task is done when the Viv route's GPU time at detail zoom with 1.6M nuclei is under 6 ms on the owner's Mac. That number needs a real GPU and a person, so it is not in this file. What this file answers is the part a script can measure: how many shapes the cull window hands to deck.gl, and what the window costs on the CPU.

## Method

The script is `packages/viewer-engine/test/overlay/cull-grid-bench.ts`. Run it with `node packages/viewer-engine/test/overlay/cull-grid-bench.ts`.

It builds one `PolygonBatch` of all the squares and one vector overlay, then calls `createOverlayLayerBuilder().build` with a view of 1920 by 1080 pixels at a zoom where a nucleus is 20 pixels across, which is the outline tier. The first build computes the level of detail statistics, the density texture, the centres, the grid and the first window. The script then pans inside the window once, and pans a whole view width away 20 times so that every build makes a new window. It ran once.

## Results

| Step | Measured |
| --- | --- |
| Shapes in the layer | 1,600,225 |
| Shapes handed to deck.gl for the window | 5,084 |
| Building the batch, earcut included | 319.0 ms |
| First build with a view (statistics, density, grid, first window) | 321.7 ms |
| A pan that stays inside the window (key check and build) | 0.1 ms |
| A new window after leaving the old one, median of 20 | 1.4 ms |
| A new window after leaving the old one, slowest of 20 | 7.8 ms |
| Heap used at the end | 57 MB |
| Array buffers at the end | 166 MB |
| Viv route GPU time at detail zoom, 1.6M nuclei, owner's Mac | TODO |

## Interpretation

At this zoom the window holds 0.3% of the layer, so the fill, casing and outline layers each draw about five thousand shapes where they drew 1.6M before. A pan inside the window costs no rebuild, and a new window costs about a millisecond of copying with no triangulation.

These are CPU timings in Node. They say nothing about GPU time, and the 6 ms line of the task is still open. The repository has no GPU timer, so the remaining step is manual: open a slide with about 1.6M nuclei on the Viv route in Chrome on the owner's Mac, zoom until outlines show, record a Performance trace while panning and read the GPU track per frame. Write the number into the `TODO` row above. TODO: name the slide and the nuclei result that give 1.6M nuclei, because this task did not confirm that one is loaded anywhere.

Two things are also not covered by any automated test. No test drives the Viv route itself with a nuclei layer, so the path from a camera move to a new window is checked only in parts: `cameraViewRect` against the camera's own screen mapping, and the builder against hand-made views. No golden scene has 500 or more small shapes, so the golden images never take the cull path. With a view, the outline tier draws the window's small shapes under the large ones within each of fills, casings and outlines, where the unculled path draws all shapes in their original order. The POC measured 4.2 to 4.41 ms for the same case (POC doc 31), which is a POC number and not a measurement of this code.
