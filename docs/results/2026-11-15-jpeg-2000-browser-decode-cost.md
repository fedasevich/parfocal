# Result: JPEG 2000 tiles decode in the browser as fast as JPEG tiles reach the screen, and stay inside the viewer budgets

- Date: 2026-11-15
- Backlog: INGEST-014 (JPEG 2000 performance decision)
- Kind: benchmark
- Commit: 42b074f9 with the INGEST-014 bench on top
- Environment: MacBook with an Apple M4 (10 cores), macOS 15.8.1, Node v26.13.1, Google Chrome 157.0.8103.51 headed through Playwright 1.64 on the hardware GPU (`ANGLE Metal Renderer: Apple M4`, checked in the run, 60 Hz, frame 16.67 ms), viewport 1280 × 720 at a device pixel ratio of 1, loopback range server behind the latency proxy. Other agents shared the machine: load average 16.8 at the start and 13.4 at the end, memory 75% to 76% free.
- Data: the public OpenSlide test slides `JP2K-33003-1.svs` (Aperio JPEG 2000 33003, 40x, 15374 × 17497, 256 px tiles, levels at downsample 1, 4 and 8), `CMU-1-JP2K-33005.svs` (Aperio JPEG 2000 33005, 20x, 240 px tiles, levels at 1, 4 and 16) and `CMU-1.svs` (the same tissue as JPEG, 256 px tiles), fixture group `formats`. No PHI.

## Question

Does decoding Aperio JPEG 2000 through OpenJPEG WebAssembly in the decode workers keep the viewer inside the VIEW-040 (viewer performance budgets) limits, or does the conversion trigger of [ADR 0306](../adr/0306-conversion-triggers-and-the-ome-zarr-target.md) (conversion triggers and the OME-Zarr target) fire?

VIEW-040 is not finished, so the limits are the ones already in `perf-budgets.json` for `CMU-1.svs` at 200 ms RTT: 6,300 ms to the fitted image (`viewer.fitted-ms`) and 5,390 ms to sharp after a jump to 10x (`viewer.jump-sharp-ms`). `viewer.pan-frame-p95-ms` has no limit yet. The pass rule, fixed before the run:

1. Fitted and sharp-after-jump times of a JPEG 2000 slide at 200 ms RTT are under those two limits at every view, including the view between two stored levels, where the most finest-level tiles are decoded.
2. With no network delay, where decode is all that is left, sharp-after-jump is at most 1.5 times the JPEG slide in the same session.
3. Frame p95 while panning is within 1 ms of the JPEG slide in the same session and no frame is over 33.4 ms.

## Method

`pnpm --filter @parfocal/viewer-engine bench:j2k` runs `packages/viewer-engine/j2k-bench/j2k-decode.spec.ts` once. It is a separate Playwright config, headed, without the SwiftShader flags, with occlusion and background throttling off, and it fails if the WebGL renderer string names SwiftShader. Slides are interleaved in every phase and every phase runs three times.

1. Codec. Node reads the raw bytes of a 6 by 6 block of level 0 tissue tiles (the densest block by byte count on `JP2K-33003-1.svs`, the tissue centre of the CMU slides). A worker on the page decodes each with `J2KDecoder.decode()`, one warm-up pass and three timed passes, 108 samples. The same is repeated with `decodeSubResolution(1, 0)` and `(2, 0)`, which stop one and two wavelet levels early.
2. Tile. The same 36 tiles are read through `createWorkerRegionReader` with one decode worker. One pass fills the byte cache, then three passes are timed from the request to the tile arriving on the page, so the time holds the message round trip, the cached byte read and the decode. The first read of the session is reported separately as the cold read, which includes fetching and instantiating the WebAssembly module.
3. Throughput. The 36 tiles are requested at once from 1, 2, 4, 6 and 8 workers on a warm byte cache, fastest of three.
4. Loads. As `browser/budgets.spec.ts` does: a fresh page creates the engine with the Viv route, opens the slide at the fitted view and waits for `whenIdle`, then sets the camera to a magnification at the tissue centre and waits again. At 0 and 200 ms RTT with six workers, and at 0 ms with 2, 4 and 8 workers. Fastest of three.
5. Pan. The slide opens at the view, then the camera moves 1,000 screen pixels a second for 3 s. Frame intervals come from `requestAnimationFrame` during the motion only. Settle is the time from the last move to `whenIdle`.

The numbers are in `packages/viewer-engine/test-results/j2k-bench/report.json` after a run (not committed).

## Results

Mean bytes per tile of the block: 27,988 (`CMU-1.svs`), 6,398 (`CMU-1-JP2K-33005.svs`), 24,916 (`JP2K-33003-1.svs`).

Codec alone, one tile in a worker, 108 samples each. Instantiating the module took 10 to 26 ms.

| Slide | Decode | p50 (ms) | p95 (ms) | Worst (ms) |
|---|---|---|---|---|
| CMU-1-JP2K-33005.svs | full | 2.50 | 3.04 | 3.44 |
| CMU-1-JP2K-33005.svs | one level less | 1.28 | 1.65 | 1.75 |
| CMU-1-JP2K-33005.svs | two levels less | 0.62 | 0.97 | 1.12 |
| JP2K-33003-1.svs | full | 5.51 | 5.94 | 9.55 |
| JP2K-33003-1.svs | one level less | 2.33 | 2.50 | 2.90 |
| JP2K-33003-1.svs | two levels less | 0.82 | 1.13 | 2.23 |

Tile through one decode worker, warm bytes, 108 samples each.

| Slide | p50 (ms) | p95 (ms) | Worst (ms) | First cold read (ms) |
|---|---|---|---|---|
| CMU-1.svs (JPEG) | 10.0 | 12.1 | 14.5 | 18 |
| CMU-1-JP2K-33005.svs | 7.3 | 9.1 | 9.9 | 48 |
| JP2K-33003-1.svs | 10.6 | 12.0 | 14.5 | 53 |

Tiles per second for 36 tiles requested at once, warm bytes.

| Workers | CMU-1.svs (JPEG) | CMU-1-JP2K-33005.svs | JP2K-33003-1.svs |
|---|---|---|---|
| 1 | 99 | 147 | 96 |
| 2 | 176 | 272 | 188 |
| 4 | 275 | 461 | 318 |
| 6 | 347 | 593 | 438 |
| 8 | 384 | 824 | 555 |

Time to the fitted image and to sharp after a jump, six workers, fastest of three (slowest of three in brackets for the jump).

| RTT (ms) | Slide | Fitted (ms) | View | Level read | Sharp after jump (ms) |
|---|---|---|---|---|---|
| 0 | CMU-1.svs (JPEG) | 1,167 | 10x | 0, shown at half size | 569 (655) |
| 0 | CMU-1.svs (JPEG) | 1,167 | 20x finest | 0 | 376 (391) |
| 0 | CMU-1-JP2K-33005.svs | 781 | 10x | 0, shown at half size | 442 (474) |
| 0 | CMU-1-JP2K-33005.svs | 781 | 20x finest | 0 | 308 (341) |
| 0 | JP2K-33003-1.svs | 598 | 10x | 1 | 318 (325) |
| 0 | JP2K-33003-1.svs | 598 | 20x | 0, shown at half size | 525 (559) |
| 0 | JP2K-33003-1.svs | 598 | 40x finest | 0 | 358 (422) |
| 200 | CMU-1.svs (JPEG) | 3,517 | 10x | 0, shown at half size | 2,902 (2,940) |
| 200 | CMU-1.svs (JPEG) | 3,517 | 20x finest | 0 | 1,506 (1,707) |
| 200 | CMU-1-JP2K-33005.svs | 3,370 | 10x | 0, shown at half size | 1,706 (1,713) |
| 200 | CMU-1-JP2K-33005.svs | 3,370 | 20x finest | 0 | 1,071 (1,106) |
| 200 | JP2K-33003-1.svs | 3,377 | 10x | 1 | 308 (326) |
| 200 | JP2K-33003-1.svs | 3,377 | 20x | 0, shown at half size | 2,723 (2,739) |
| 200 | JP2K-33003-1.svs | 3,377 | 40x finest | 0 | 1,492 (1,505) |

Sharp after a jump at 0 ms RTT by worker count, fastest of three, in ms.

| Workers | CMU-1.svs 10x | CMU-1-JP2K-33005.svs 10x | JP2K-33003-1.svs 20x | JP2K-33003-1.svs 40x |
|---|---|---|---|---|
| 2 | 771 | 591 | 742 | 425 |
| 4 | 608 | 457 | 542 | 370 |
| 6 | 569 | 442 | 525 | 358 |
| 8 | 558 | 391 | 458 | 341 |

Pan at 1,000 px a second for 3 s, six workers, 0 ms RTT, 180 frames per run, three runs. The ranges cover the three runs.

| Slide | View | Frame p50 (ms) | Frame p95 (ms) | Worst frame (ms) | Frames over 33.4 ms | Settle (ms) |
|---|---|---|---|---|---|---|
| CMU-1.svs (JPEG) | 10x | 16.7 | 18.1 to 18.3 | 18.7 | 0 | 131 to 132 |
| CMU-1.svs (JPEG) | 20x finest | 16.7 | 18.2 to 18.3 | 18.7 | 0 | 98 to 99 |
| CMU-1-JP2K-33005.svs | 10x | 16.7 | 18.1 to 18.4 | 18.6 | 0 | 65 to 66 |
| CMU-1-JP2K-33005.svs | 20x finest | 16.7 | 18.0 to 18.4 | 18.6 | 0 | 97 to 99 |
| JP2K-33003-1.svs | 20x | 16.7 | 18.1 to 18.2 | 18.6 | 0 | 181 |
| JP2K-33003-1.svs | 40x finest | 16.7 | 18.3 | 18.6 | 0 | 180 to 182 |

## Interpretation

Facts.

- Rule 1 holds. The slowest JPEG 2000 time at 200 ms RTT is 3,377 ms to the fitted image against a limit of 6,300 ms and 2,739 ms to sharp against a limit of 5,390 ms, on the hardware GPU. The JPEG slide in the same session took 3,517 and 2,940 ms.
- Rule 2 holds. With no network delay the worst JPEG 2000 jump, `JP2K-33003-1.svs` at 20x, took 525 ms against 569 ms for the JPEG slide's equivalent view, a ratio of 0.92. `CMU-1-JP2K-33005.svs` was faster than its JPEG twin at both views.
- Rule 3 holds. Frame p95 is 18.0 to 18.4 ms on every slide, one 60 Hz frame plus timer jitter, and no frame was over 18.7 ms. Decoding is off the main thread, so the codec cannot reach the frame time.
- A JPEG 2000 tile costs 2.5 ms (33005, 6.4 kB) to 5.5 ms (33003, 24.9 kB) of pure decode, p95 3.0 and 5.9 ms. Through the worker a tile arrives in 7.3 to 10.6 ms at p50 and 9.1 to 12.0 ms at p95, against 10.0 and 12.1 ms for a JPEG tile of the same pipeline.
- The first tile of a session costs about 30 ms more than JPEG (48 to 53 ms against 18 ms), once per decode worker, for fetching and instantiating the module.
- Throughput grows with every worker up to 8, and at six workers a JPEG 2000 slide delivers 438 to 593 tiles a second against 347 for JPEG.
- Settle after a pan on `JP2K-33003-1.svs` is about 180 ms against 65 to 132 ms on the CMU slides.

Assumptions.

- The sharp time of `JP2K-33003-1.svs` at 10x is 308 ms even at 200 ms RTT. The likely reason is that its level at downsample 4 is small (3843 × 4374) and its bytes were already in the range cache after the fitted view. It is not a codec effect.
- The 50 ms longer settle on `JP2K-33003-1.svs` was not traced. It is a different slide with larger tiles in bytes than `CMU-1-JP2K-33005.svs`, and the difference is under four frames.
- The machine was shared, so absolute times are upper bounds. The slides were interleaved, so the comparison between codecs is fair.
- An M4 is a fast laptop. On a CPU three times slower the pure decode would be about 17 ms per 33003 tile, and six workers would still deliver over 100 tiles a second against the 77 to 85 tiles a 3 s pan needed here. This was not measured.

Limits. Two JPEG 2000 slides, both Aperio, one machine, one run of three repetitions. The decode at fewer wavelet levels was timed but its output size and pixels were not checked, because the build's frame info reports the full size. HTJ2K was not measured: the repository has no HTJ2K decoder and no HTJ2K slide, and adding one was not needed once the native path passed.

## Follow-ups

- The ADR for INGEST-014 (JPEG 2000 slides stay native, `docs/adr/XXXX-jpeg-2000-slides-stay-native.md`) records the decision, and ADR 0306 is updated: the `jpeg2000-decode-budget` trigger has not fired.
- A cheap gain is left unused: decoding one or two wavelet levels less is 2.4 to 6.7 times faster and would suit views between two stored levels, such as 20x on a 40x slide with levels at 1, 4 and 8. It is not needed for the budgets.
- TODO: repeat on a slower machine and on a 100,000 px wide JPEG 2000 slide when one is available.
- TODO: VIEW-040 can take the JPEG pan numbers here (p95 18.3 ms at 60 Hz) as a first value for `viewer.pan-frame-p95-ms`.
