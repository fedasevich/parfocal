# Result: time to a sharp view after a straight pan, with and without prefetch

- Date: 2026-11-04
- Backlog: VIEW-044
- Kind: benchmark
- Commit: a218f20 plus the uncommitted VIEW-044 change that this run measured
- Environment: cloud Linux container, 4 CPUs shared with other agents, load average 23.4 before the run and 24.6 after it, Chromium from the preinstalled Playwright (`channel: "chrome"`) with SwiftShader, viewport 1280 by 720, device scale factor 1, 6 decode workers, latency proxy at 100 ms RTT with no bandwidth limit
- Data: a synthetic generic TIFF made for this run (32768 by 16384 pixels, 6 levels, 256 pixel JPEG tiles, 0.5 microns per pixel, 97 MiB, noise texture, no PHI). CMU-1.svs could not be downloaded in this container, because the proxy answers 403 for openslide.cs.cmu.edu.

## Question

VIEW-044 asks for the time to a sharp view at 100 ms RTT with and without prediction. A prediction should make the tiles that the pan is about to reveal arrive before the view gets there, so the time from the end of the pan to a fully drawn view should drop.

## Method

`packages/viewer-engine/browser/prefetch.spec.ts` opens the slide through the latency proxy at 10x, then drives the camera straight down for 2400 ms at 1500 screen pixels a second, moving each frame by the elapsed time. It then waits for `route.whenIdle()` and records the time that takes (`settleMs`). The run alternates prefetch off and on, 5 pairs, with a fresh page and a fresh slide open for each run. A second test pans at 100 pixels a second while zig-zagging 60 pixels across, and records what is requested.

The spec takes its slide from `PREFETCH_SLIDE`, `PREFETCH_FORMAT`, `PREFETCH_X` and `PREFETCH_Y` when they are set, and uses CMU-1.svs otherwise. This run used `PREFETCH_REPEATS=5 PREFETCH_FORMAT=generic-tiff PREFETCH_X=8192 PREFETCH_Y=2000` with Playwright timeouts raised, and Playwright's own port 5193 for the dev server (no dev server was needed).

## Results

Straight pan, time from the end of the pan to a sharp view:

| Pair | Off, ms | On, ms | Frames off | Frames on | Slide fetches off | Slide fetches on | Tiles requested ahead | Started | Dropped from the queue | Used by a visible tile |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 1015 | 617 | 18 | 13 | 9 | 9 | 90 | 48 | 42 | 42 |
| 2 | 547 | 641 | 12 | 12 | 8 | 9 | 84 | 48 | 36 | 39 |
| 3 | 814 | 774 | 11 | 13 | 8 | 9 | 96 | 76 | 20 | 64 |
| 4 | 651 | 1223 | 13 | 8 | 8 | 10 | 48 | 27 | 21 | 14 |
| 5 | 882 | 811 | 10 | 10 | 9 | 10 | 72 | 54 | 18 | 30 |
| Median | 814 | 774 | | | | | | | | |
| Mean | 781.8 | 813.2 | | | | | | | | |

Zig-zag pan, prefetch on: 0 tiles requested ahead, 11 frames, 1 slide fetch.

Unit tests (`pnpm --filter @parfocal/viewer-engine test`): on a scripted straight pan every tile that enters the view after the first 5 frames had been requested before it entered; on a zig-zag path nothing is requested; the lead never passes 1.25 viewports; prefetch jobs queue behind visible ones, use at most half the workers, are dropped from the queue and never aborted once started.

## Interpretation

The prediction works: 48 to 96 tiles were requested ahead in each straight run and 14 to 64 of them were later used by a visible tile, and a zig-zag requested none. The time to a sharp view did not change in a way these runs can show. The medians are 814 ms without and 774 ms with prediction, the means are 781.8 and 813.2 ms, and the spread inside each column (547 to 1015 and 617 to 1223) is larger than the difference. The machine ran at a load of about 24 on 4 CPUs, the pan reached only 8 to 18 frames in 2.4 s, and decoding and drawing on SwiftShader took most of the settle time, so the 100 ms round trips were a small part of it (8 to 10 slide fetches in a pan). Assumption, not measured: on an idle machine with a real GPU the network share is larger and the gain would show. Do not read these numbers as a win or a loss.

## Follow-ups

TODO: repeat on an idle machine with CMU-1.svs and a longer pan, and add a row for 200 ms RTT.
TODO: the developer drawer's "Prefetch ahead of motion" and "Show the motion vector" switches in `apps/web` are still stand-ins. The route offers `setPrefetch`, `prefetchEnabled`, `prefetchVector` and `prefetchStats` for them to call.
