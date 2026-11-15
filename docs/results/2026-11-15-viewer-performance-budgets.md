# Result: three CMU-1 encodings pan at a frame p95 of 18.0 to 18.4 ms and draw the raster in 0.4 ms of GPU, and their CPU-side baselines fit the VIEW-040 budgets

- Date: 2026-11-15
- Backlog: VIEW-040 (viewer performance budgets)
- Kind: baseline
- Commit: 5e5a5286 with the VIEW-040 changes on top, not yet committed
- Environment: MacBook with an Apple M4 (10 cores), macOS 15.8.1, Google Chrome 157.0.8103.51 through Playwright 1.64. CPU-side runs in Chrome headless with SwiftShader, 1280 × 720 at a device pixel ratio of 1, through the latency proxy. The frame run in Chrome headed on the hardware GPU (`ANGLE Metal Renderer: Apple M4`, checked in the run, 60 Hz, frame 16.67 ms), 1280 × 720 at a device pixel ratio of 1, occlusion and background throttling off. Other agents shared the machine. The load average was about 18 for the first CPU-side run, 34 to 70 for the second and 13.9 at the start and 12.7 at the end of the frame run. Hosted numbers come from the logs of seven `browser (viewer-engine)` jobs of CI runs 43647240859 to 43667253407 on 2026-11-14 and 2026-11-15.
- Data: the public OpenSlide test slides `CMU-1.svs` (Aperio JPEG), `CMU-1-JP2K-33005.svs` (Aperio JPEG 2000 33005) and `CMU-1.tiff` (generic tiled JPEG TIFF), the same CMU-1 tissue, fixture group `viewer`. No PHI.

## Question

What are the baselines of the per-format VIEW-040 budgets on the three slides CI downloads, and what are frame p95 while panning and the raster GPU time on a real GPU?

## Method

1. `pnpm exec playwright test browser/budgets.spec.ts --workers=1` in `packages/viewer-engine`. For each slide and each RTT of the matrix (0, 50, 100 and 200 ms), three runs each create the engine with six decode workers, open the slide at the fitted view and wait for `whenIdle`, then set the camera to 10x at the tissue centre (28,750, 10,700) and wait again. Times are the fastest of three, requests and bytes the most of three. At 0 ms RTT each run also traces the main thread from the jump to idle (longest page task, fastest of three) and reads `performance.measureUserAgentSpecificMemory()` after the jump (largest of three). `CMU-1.tiff` has no pixel size, so the harness uses the 0.499 µm of `CMU-1.svs` for the 10x zoom.
2. `pnpm exec playwright test browser/decode-budget.spec.ts --workers=1`. One decode worker reads a 6 by 6 block of level 0 tissue tiles once to fill the byte cache, then three times more, timed from the request to the pixels arriving on the page. The p95 of the 108 timed reads, fastest of three passes. The blocks are those of the INGEST-014 bench.
3. `pnpm --filter @parfocal/viewer-engine bench:frames` runs `frame-bench/frame-budgets.spec.ts` once, three rounds with the slides interleaved. Each opens the slide at 10x, times 120 forced `deck.redraw` calls after 20 warm-up ones with `EXT_disjoint_timer_query_webgl2` and a fence, then moves the camera 1,000 screen pixels a second for 3 s and records `requestAnimationFrame` intervals during the motion only.

The frame run writes `packages/viewer-engine/test-results/frame-bench/report.json` (not committed).

## Results

Hosted runner, `CMU-1.svs`, seven green runs, fastest of three per run:

| RTT (ms) | Fitted (ms) | Sharp after jump (ms) |
|---|---|---|
| 0 | 1,727 to 2,677 | 1,025 to 1,402 |
| 50 | 2,344 to 2,989 | 1,246 to 1,753 |
| 100 | 2,837 to 3,669 | 1,643 to 1,846 |
| 200 | 4,064 to 4,913, median 4,306 | 2,907 to 2,999, median 2,928 |

Apple M4 with SwiftShader, requests and bytes (the same at every RTT):

| Slide | Fitted requests | Fitted bytes | Jump requests | Jump bytes |
|---|---|---|---|---|
| CMU-1.svs | 8 | 7,683,267 | 13 | 13,631,488 |
| CMU-1-JP2K-33005.svs | 4 | 3,590,495 | 7 | 7,340,032 |
| CMU-1.tiff | 7 | 6,985,558 | 4 | 4,194,304 |

Apple M4 with SwiftShader, times:

| Slide | Fitted at 0 / 200 ms RTT (ms) | Sharp after jump at 0 / 200 ms RTT (ms) | Longest main-thread task in the jump (ms) | Memory after the jump (bytes) | Warm tile p95, one worker (ms) |
|---|---|---|---|---|---|
| CMU-1.svs | 1,654 / 5,234 | 799 / 2,949 | 9.0 | 73,382,587 | 14.8 |
| CMU-1-JP2K-33005.svs | 2,789 / 3,485 | 477 / 1,748 | 12.3 | 62,323,727 | 10.8 |
| CMU-1.tiff | 867 / 3,357 | 351 / 1,080 | 12.4 | 63,494,721 | 5.1 |

The `CMU-1.tiff` and tile rows come from the second run, under the higher load. A third run against the final budget file, at a load average of 15 to 30, passed all 15 tests with the same requests and bytes, memory within 0.1 percent (73,338,798, 62,388,718 and 63,510,685 bytes), longest jump tasks of 8.9, 13.6 and 10.4 ms, tile p95 of 11.0, 7.9 and 3.9 ms, and 200 ms RTT times of 3,498 / 2,911, 3,370 / 1,710 and 3,375 / 1,079 ms fitted / sharp.

Apple M4 hardware GPU, 10x, three rounds (ranges cover the rounds):

| Slide | Raster GPU median (ms) | Raster GPU p95 (ms) | Fence median (ms) | Pan frame p50 (ms) | Pan frame p95 (ms) | Worst frame (ms) | Frames over 33.4 ms | Settle (ms) |
|---|---|---|---|---|---|---|---|---|
| CMU-1.svs | 0.40 | 0.51 | 1.95 to 2.03 | 16.7 | 18.2 to 18.3 | 18.7 | 0 | 132 |
| CMU-1-JP2K-33005.svs | 0.40 | 0.51 | 1.88 to 2.11 | 16.7 | 18.0 to 18.4 | 18.7 | 0 | 48 to 65 |
| CMU-1.tiff | 0.22 to 0.40 | 0.40 to 0.51 | 1.33 to 2.03 | 16.7 | 18.0 to 18.4 | 18.6 | 0 | 132 to 133 |

## Interpretation

Facts.

- Requests and bytes are the same at every RTT on all three slides, so they hold the 20 percent rule of ADR 0154 on any runner.
- On the hosted runner the jump at 200 ms RTT varies by 92 ms over seven runs and the fitted view by 849 ms. `viewer.jump-sharp-ms` is tightened from 5,390 to 4,390 ms, 1.5 times the hosted median. `viewer.fitted-ms` stays at 6,300 ms, which is 28 percent over the slowest hosted run.
- The longest main-thread task from a jump to idle is 9.0 to 12.4 ms on the M4, under the 50 ms line of VIEW-031 (wheel zoom has no frame over 50 ms) and in line with the 0 to 3 ms of blocking of POC doc 24, which counts only the part over 50 ms of each long frame.
- Memory after a fitted view and one jump is 62 to 73 MB for the page and its six workers, against 260 MB or more per CMU-1 slide after a full tour in POC doc 24.
- Frame p95 is 18.0 to 18.4 ms on every slide at 60 Hz, one frame plus timer jitter, and no frame was over 18.7 ms. The manual limit is 20 ms with no frame over 33.4 ms, which matches POC doc 31's pan at 60 fps with no frame over 18 ms.
- The raster costs 0.4 ms of GPU per redraw at 1280 × 720, under the 1.07 to 1.35 ms POC doc 23 measured for Viv's raster on a larger canvas. The manual limit is 1.35 ms.

Assumptions.

- The M4 CPU-side baselines were taken while other agents loaded the machine, so they are upper bounds. The second run's load average reached 70.
- The hosted runner is assumed at most three times slower than the M4 on CPU work, as ADR 0154 does. Against the quiet M4 run of TEST-006 (859 ms fitted and 283 ms for the jump at 0 ms RTT), seven hosted runs were 2.0 to 3.1 times slower to the fitted view and 3.6 to 5.0 times slower on the jump, so the new 0 ms time budgets may need a hosted baseline after the first CI run.
- The timer query brackets one forced redraw. It does not count compositing, so it is the raster's own GPU cost, not the frame's.

Limits. One machine, one frame run of three rounds, three encodings of one tissue. The memory number leaves out GPU textures. The frame rate is capped by the 60 Hz display, so a p95 near 16.7 ms says frames are on time, not how much spare time each has.

## Follow-ups

- TODO: take the hosted numbers of the new budgets from the first CI run and tighten their limits.
- TODO: repeat the frame run before the M2 gate and when a change targets rendering speed, as ADR 0011 says.
