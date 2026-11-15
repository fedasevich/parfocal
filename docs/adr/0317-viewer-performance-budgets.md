# 0317. Viewer performance budgets per format, CPU-side in CI and frame and GPU time by hand

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-040 (viewer performance budgets). Builds on [ADR 0011](0011-hosted-ci-only.md) (hosted CI runners only) and [ADR 0154](0154-performance-budget-file-and-regression-rule.md) (one budget file, byte and count budgets fail at 20 percent). Used by [ADR 0316](0316-jpeg-2000-slides-stay-native.md) (JPEG 2000 slides stay native) and the `jpeg2000-decode-budget` trigger of [ADR 0306](0306-conversion-triggers-and-the-ome-zarr-target.md) (conversion triggers and the OME-Zarr target).

## Context

TEST-006 (performance budget suite) budgeted one slide, `CMU-1.svs`, for time to the fitted image and to sharp after a jump. VIEW-040 asks for budgets per format and RTT, frame p95 while panning and a heap ceiling, with the CPU-side ones enforced on hosted runners and the frame and GPU-time ones run by hand on the owner's Mac, as ADR 0011 says. The wheel zoom main-thread budget names the Huron slides, which the CI fixture groups `small` and `viewer` do not download, so every hosted run skipped it and no main-thread budget was enforced in CI. The `viewer` group does hold three encodings of the same CMU-1 tissue: Aperio JPEG (`CMU-1.svs`), Aperio JPEG 2000 33005 (`CMU-1-JP2K-33005.svs`) and a generic tiled JPEG TIFF (`CMU-1.tiff`).

The POC tuned these numbers:

- POC doc 09 (claims retested) puts the open of a pyramidal slide on object storage at 3.25 to 4.8 s at about 200 ms per round trip, and POC doc 32 (JPEG chunks and latency) shows that time grows with requests, not bytes.
- POC doc 24 (main thread and memory) holds every interaction to 0 to 3 ms of blocking after its fixes, and keeps 111 to 119 MB of main-thread memory and 150 to 452 MB of worker memory per CMU-1 slide after a full tour.
- POC doc 31 (culling, paging and decoder stutter) pans at 60 fps with no frame over 18 ms, and POC doc 23 (deck.gl WebGPU three way) measures Viv drawing the raster alone in 1.07 to 1.35 ms of GPU per frame.

## Options considered

1. Keep one slide and add frame and memory checks to it. Cheap, but a JPEG 2000 or TIFF regression passes, and those decode paths are the ones that differ.
2. Run the same fitted, jump, main-thread, heap and decode checks on all three CMU-1 encodings in CI, and the frame and GPU-time checks on the same three slides by hand. Costs about three more minutes of the `browser (viewer-engine)` job and no new fixtures.
3. Add a slide per POC format to CI. Every format would be guarded, but the CI fixture cache would grow by gigabytes on a free runner.

## Decision

Option 2. Every number is in `perf-budgets.json` with its baseline, limit, reason and check.

| Budget per slide | Where | Limit and its source |
|---|---|---|
| Requests and bytes to the fitted image and to sharp after a jump to 10x | CI, every RTT of the matrix | 1.2 times the baseline (ADR 0154) |
| Time to the fitted image at 200 ms RTT | CI | 6,300 ms on every slide, the limit INGEST-014 (JPEG 2000 performance decision) used, inside the POC's 3.25 to 4.8 s open plus the runner's slower CPU part |
| Time to sharp after a jump at 200 ms RTT | CI | `CMU-1.svs` 4,390 ms, 1.5 times the median of seven hosted runs (tightened from 5,390 ms). The other two slides twice their baseline |
| Longest main-thread task from the jump until idle, 0 ms RTT | CI | 78 ms, 1.5 times the median of four hosted samples (52 ms), raised on 2026-11-15 from the 50 ms VIEW-031 (wheel zoom has no frame over 50 ms) line, which the M4 still holds at 9 to 14 ms. POC doc 24 is 0 to 3 ms of blocking |
| Page and worker memory after the fitted view and the jump, `measureUserAgentSpecificMemory`, 0 ms RTT | CI | 1.2 times the baseline of 62 to 73 MB, well under the POC's 260 MB or more per CMU-1 slide after a tour |
| p95 of one warm tile through one decode worker | CI | Three times the Apple M4 baseline of 5.1 to 14.8 ms |
| Frame p95 while panning at 1,000 screen px a second at 10x | The Mac, by hand | Set from the result file. POC doc 31 is no frame over 18 ms at 60 Hz |
| GPU time of one forced redraw of the raster at 10x | The Mac, by hand | Set from the result file. POC doc 23 is 1.07 to 1.35 ms for Viv's raster |

`packages/viewer-engine/browser/budgets.spec.ts` and `browser/decode-budget.spec.ts` run in the existing CI browser job. `pnpm --filter @parfocal/viewer-engine bench:frames` runs `frame-bench/frame-budgets.spec.ts` headed on the hardware GPU, fails on SwiftShader, writes `test-results/frame-bench/report.json` and soft-fails a budget it breaks.

## Consequences

- A JPEG 2000 slide that opens slower than the JPEG limit now fails CI, so the ADR 0306 trigger is watched on every pull request, not only by the INGEST-014 bench.
- The main-thread and memory budgets run on hosted runners for the first time. Their baselines are Apple M4 numbers taken while other agents loaded the machine. TODO: record the hosted numbers from the first CI run and tighten the time limits, as ADR 0154 asks.
- The memory number counts JavaScript and ArrayBuffer memory of the page and its workers, not GPU textures. GPU memory stays a manual check.
- Frame and GPU time are only checked when someone runs the bench, before the M2 gate and when a change targets rendering speed.
