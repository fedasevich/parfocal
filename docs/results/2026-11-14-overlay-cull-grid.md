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

## How to rerun on the Mac

One command times both open budgets (VIEW-028, overlay level of detail, under 1 ms at overview with 81k nuclei, and VIEW-029, this cull grid, under 6 ms at detail zoom with 1.6M nuclei) on the real GPU. Run it in a terminal on the Mac, with nothing else heavy open and the laptop on power:

```
pnpm --filter @parfocal/web gpu-timing
```

It is the same as `pnpm --filter @parfocal/viewer-engine gpu-timing`. The command builds a bench page with Vite, serves it with the small synthetic slide `synthetic-zlib.ome.tiff` on a random local port, opens headed Chrome (`channel: "chrome"`, hardware GPU), mounts the real Viv route and sets one nuclei overlay on it. When it ends, Playwright closes the browser and the global teardown closes the server, so nothing keeps running. Leave the Chrome window alone while it runs, which takes about a minute.

The two cases are squares of side 6 on a grid of pitch 20, centred on the slide, on a window of 1440 by 900 CSS pixels at device pixel ratio 2. The overview case has 285 by 285 = 81,225 nuclei at 1 px across, which is the density tier. The detail case has 1265 by 1265 = 1,600,225 nuclei at 20 px across, which is the outline tier with the cull grid. Each case draws 20 warm-up frames and then 120 timed frames, once with no overlay and once with the overlay, at the same camera after the route is idle. Each frame is a forced `deck.redraw`, and its end is a WebGL fence (`fenceSync` and `clientWaitSync`, polled across tasks), never `gl.finish`. When Chrome offers `EXT_disjoint_timer_query_webgl2` the GPU time is that query around the redraw, and the fence time is kept next to it. If the extension is missing the fence time is used and the report says so in `timingSource`.

The terminal prints two lines, each with its budget:

- Overview, 81k nuclei, overlay GPU time: the median of the frames with the overlay minus the median without it, against 1 ms.
- Detail zoom, 1.6M nuclei, Viv route GPU time: the median frame with the overlay, slide tiles included, against 6 ms. The overlay's own share is printed under it.

It also writes `packages/viewer-engine/test-results/gpu-timing/report.json` with the GPU name, canvas size, timing source, medians, 95th percentiles and the pass flags, ready to paste into this file's table. The test fails when either number is over its budget, and the JSON is written first either way. Set `GPU_TIMING_DPR`, `GPU_TIMING_WIDTH` and `GPU_TIMING_HEIGHT` to change the window, and say which values were used in the result file. The scripts are `packages/viewer-engine/gpu-bench/gpu-timing.spec.ts` and `packages/viewer-engine/gpu-bench/page/gpu-timing-harness.ts`.

The slide behind the overlay is the small synthetic one, so the slide tiles add little GPU work. The 6 ms line therefore covers the overlay and a light slide layer, and a real slide will add its tile cost on top.

## Interpretation

At this zoom the window holds 0.3% of the layer, so the fill, casing and outline layers each draw about five thousand shapes where they drew 1.6M before. A pan inside the window costs no rebuild, and a new window costs about a millisecond of copying with no triangulation.

These are CPU timings in Node. They say nothing about GPU time, and the 6 ms line of the task is still open. The repository has no GPU timer, so the remaining step is manual: open a slide with about 1.6M nuclei on the Viv route in Chrome on the owner's Mac, zoom until outlines show, record a Performance trace while panning and read the GPU track per frame. Write the number into the `TODO` row above. TODO: name the slide and the nuclei result that give 1.6M nuclei, because this task did not confirm that one is loaded anywhere.

Two things are also not covered by any automated test. No test drives the Viv route itself with a nuclei layer, so the path from a camera move to a new window is checked only in parts: `cameraViewRect` against the camera's own screen mapping, and the builder against hand-made views. No golden scene has 500 or more small shapes, so the golden images never take the cull path. With a view, the outline tier draws the window's small shapes under the large ones within each of fills, casings and outlines, where the unculled path draws all shapes in their original order. The POC measured 4.2 to 4.41 ms for the same case (POC doc 31), which is a POC number and not a measurement of this code.
