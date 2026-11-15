# Result: Viv, deck.gl WebGPU and custom WebGPU pan CMU-1 at the same frame p95 of 18.6 ms with no frame over 33 ms on the Mac's GPU

- Date: 2026-11-15
- Backlog: VIEW-039 (renderer head-to-head benchmark)
- Kind: benchmark
- Commit: 8c148200 with the VIEW-039 changes on top, not yet committed
- Environment: MacBook with an Apple M4, macOS Darwin 24.6.0, Google Chrome 157.0.8103.51 through Playwright 1.64, headed with `PARFOCAL_GPU=hardware` on the hardware GPU (WebGL `ANGLE Metal Renderer: Apple M4`, WebGPU adapter vendor `apple`, not a fallback adapter, both checked in the run), 1280 × 720 at a device pixel ratio of 1, 60 Hz, occlusion and background throttling off. Other agents shared the machine and nothing kept it quiet: the 1-minute load average was 32.9 at the start and 53.2 at the end. The run was done once, with three rounds inside it.
- Data: the public OpenSlide test slide `CMU-1.svs` (Aperio JPEG), fixture group `viewer`. No PHI.

## Question

How do the three pixel routes behind the renderer route interface compare on one fixed camera path, with GPU completion timing and with a pixel check so an empty frame cannot pass? The pan table is laid out like the pan table of POC doc 31 (culling the nucleus layer, paging whole-slide results and decoder stutter), and the GPU table like the per-frame GPU tables of POC doc 23 (deck.gl 9.4 on WebGPU measured against Viv and the custom engine).

## Method

`PARFOCAL_GPU=hardware pnpm --filter @parfocal/viewer-engine bench:routes` runs `frame-bench/route-head-to-head.spec.ts` with the `bench:frames` page and config. Three rounds, routes interleaved as Viv, deck-webgpu, custom-webgpu in each, a fresh page per route.

1. Open CMU-1 at 10x, 3,000 screen pixels left of the tissue centre, and wait until the route is idle. The open time is to that point.
2. Pan right at 1,000 screen pixels a second for 3 s, ending on the tissue centre, and record `requestAnimationFrame` intervals during the motion only. Check the pixels after the pan.
3. Jump to 2x, 10x and 20x at the tissue centre. At each stop wait until idle (the settle time), check the pixels, time 120 forced frames after 20 warm-up ones, then check the pixels again.

GPU completion per route. Viv forces `deck.redraw` and reads `EXT_disjoint_timer_query_webgl2`, with a WebGL2 fence as the fallback, as `bench:frames` does. deck-webgpu forces `deck.redraw`, submits the device's command encoder and awaits `GPUQueue.onSubmittedWorkDone()`. custom-webgpu draws in a render worker, so the harness wraps the worker, posts the last frame again under its own id and waits for the worker's `drawn` reply, which the worker sends after `onSubmittedWorkDone()`. `gl.finish` is not used.

The pixel check takes a screenshot of the viewer and asserts that more than 20% of pixels have a channel below 231 (tissue) and that the luma standard deviation is above 8. It also reports the mean absolute channel difference from the Viv screenshot of the same round and stop. Each route must also report zero uncaptured GPU errors and no harness errors.

## Results

Pan at 10x, 3 rounds of 3 s each, frame intervals in ms. p50 is the median of the three rounds, p95 and worst are the slowest round. p99 is not recorded by the harness.

| Route | Case | Frames | p50 | p95 | Worst | Over 33 ms | Open to idle (median) |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Viv | pan only | 540 | 16.7 | 18.6 | 18.7 | 0 | 1,822 ms |
| deck.gl WebGPU | pan only | 540 | 16.7 | 18.6 | 18.7 | 0 | 1,357 ms |
| custom WebGPU | pan only | 540 | 16.7 | 18.6 | 18.7 | 0 | 1,281 ms |

Forced frame to GPU done, ms, median of the three round medians / slowest round p95. The three sources measure different spans, see the interpretation.

| Zoom | Viv (timer query) | deck.gl WebGPU (submitted work done) | custom WebGPU (worker drawn) |
| ---: | ---: | ---: | ---: |
| 2x | 0.41 / 2.93 | 2.20 / 4.96 | 16.64 / 18.55 |
| 10x | 0.40 / 2.99 | 1.66 / 4.40 | 16.63 / 18.44 |
| 20x | 0.40 / 3.02 | 1.80 / 4.12 | 16.66 / 18.63 |

Settle after the jump, ms, median of three rounds.

| Zoom | Viv | deck.gl WebGPU | custom WebGPU |
| ---: | ---: | ---: | ---: |
| 2x | 830 | 986 | 943 |
| 10x | 13 | 13 | 39 |
| 20x | 330 | 410 | 368 |

Mean absolute channel difference from Viv at the same stop, on a 0 to 255 scale: 0.0126 at 2x, 0.0001 at 10x and 0.0005 at 20x, the same for both WebGPU routes. Every pixel check passed, and every route reported zero uncaptured GPU errors. A first full run failed the check at open, because the pan start 3,000 pixels left of the centre shows background (0.16% tissue), so the check was moved to after the pan, which ends on tissue.

## Interpretation

On this path and slide the three routes are indistinguishable while panning: all hold 60 Hz with a p95 of 18.6 ms and no frame over 33 ms, on a loaded machine. They also draw the same pixels, within a mean of 0.013 grey levels, which agrees with the earlier [real GPU route result](2026-11-15-renderer-route-picker-on-a-real-gpu.md).

The GPU numbers are not one quantity. Viv's timer query is GPU execution only, so 0.4 ms is the raster's own cost, as in the [viewer budgets result](2026-11-15-viewer-performance-budgets.md). The deck.gl WebGPU number spans the CPU draw, the submit and the queue round trip to completion, so 1.7 to 2.2 ms is an upper bound on its GPU cost. The custom WebGPU number also includes the render worker's wait for its next animation frame, which dominates at about one refresh interval (16.7 ms), so it says the worker draws every posted frame within the next refresh and nothing finer. A like-for-like GPU time needs timestamp queries inside the WebGPU routes. POC doc 23 found a polled fence inflates times to 10 to 21 ms for the same reason, so the WebGPU spans here should not be read as GPU cost.

This benchmark has no nucleus overlay, so it does not repeat the overlay rows of POC docs 23 and 31. Those differences between routes came from overlays, and the raster-only path here shows none.

## Follow-ups

- TODO: timestamp queries in the two WebGPU routes would give a GPU time comparable with Viv's timer query. The custom WebGPU folder was being changed by another task during this run and was not touched.
- TODO: an overlay case with 100k and 1M nuclei on the same camera path would make the table comparable with the overlay rows of POC docs 23 and 31.
