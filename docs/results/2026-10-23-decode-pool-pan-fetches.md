# Result: fetches and bytes with the decode worker pool

- Date: 2026-10-23
- Backlog: VIEW-004 (decode worker pool)
- Kind: benchmark
- Commit: 5c54753 with the VIEW-004 changes on top, not yet committed
- Environment: MacBook with Apple M4 (10 cores, 24 GB), macOS 15.8.1, Node 26.9.0, pnpm 12.9.1, Google Chrome 155.0.8059.86 driven headless by `@playwright/test` 1.64.0 with `channel: "chrome"` and the SwiftShader flags of `packages/golden-images/src/playwright.ts`. Viewport 1280 × 720 CSS pixels at a device pixel ratio of 1. Cross-origin isolated page. Slide and page served on localhost through `@parfocal/latency-proxy` with the RTT in the tables and no bandwidth limit. geotiff 3.0.5, Viv 0.23.0, deck.gl 9.4.0
- Data: `CMU-1.svs` (Aperio, 46,000 × 32,914, 0.499 µm, `viewer` and `formats` fixture groups) and the committed `synthetic-jpeg.tiff` (87,497 bytes)

## Question

Does the Viv route, decoding in six workers, pan without a fetch storm and without downloading any byte twice? And does keeping started work fix the POC regression of doc 06 note 11, where dropping late chunks gave 10,324 fetches and 7,743 MB against a correct 19 fetches and 14.3 MB to the first stable view of a 21-gigapixel BigTIFF?

## Method

Two tests, both in `packages/viewer-engine`.

The regression test, `test/decode/fetch-storm.test.ts`, runs in Node with `node --test`. It serves `synthetic-jpeg.tiff` through the latency proxy at 60 ms RTT and plays a caller that, every 16 ms frame, aborts and re-asks for every tile of the bottom row of level 0 that has not arrived yet (4 tiles), for at most 40 frames. Fetches and bytes are the proxy's counters, reset before the frames start.

- "Cancelling downloads" opens the TIFF source with `fetch: globalThis.fetch`, which turns off geotiff's block cache, so an aborted tile aborts its download and nothing keeps a late chunk.
- "Pool" reads the same tiles through `createWorkerRegionReader` with six in-process workers and the shared range cache. The reader is created after the counters are reset, so its fetches include opening the slide.

The pan test, `browser/pan.spec.ts`, runs in Chrome with `pnpm --filter @parfocal/viewer-engine test:browser`, and `PAN_RTT_MS` sets the RTT (default 100). Each run opens `CMU-1.svs` at 10x with the camera on the tissue centre (28,750, 10,700), waits for `whenIdle`, pans right 40 screen pixels per animation frame for 90 frames, waits for `whenIdle` again, pans back the same way and waits again. The slide server logs every request and the bytes it sent. The test counts requests for `CMU-1.svs` and adds up the bytes per phase. "Duplicate bytes" is the sum of bytes minus the size of the union of the byte ranges. Three setups run in turn:

- "Workers" is the Viv route with six decode workers and the shared range cache.
- "Page, shared bytes" decodes on the page (`decodeWorkers: 0`) through the same range cache.
- "Page, geotiff direct" is the VIEW-002 path, geotiff's own 1 MiB block cache on the page with abort signals passed through.

The runs were RTT 0 once, RTT 100 three times and RTT 200 once.

## Results

The regression test gave the same numbers in five runs:

| Reader | Frames | Converged | Fetches | Bytes |
|---|---:|---|---:|---:|
| Cancelling downloads | 40 | no | 160 | 0 |
| Pool | 6 | yes | 1 | 87,497 |

In the pool run each of the 4 tiles was decoded once. Its jobs were orphaned in flight and then joined by the next frame's request, so none started twice.

Pan totals over open, outbound and back:

| Run | RTT ms | Setup | Fetches | Bytes | Duplicate bytes |
|---|---:|---|---:|---:|---:|
| 1 | 0 | Workers | 45 | 48,577,731 | 0 |
| 1 | 0 | Page, shared bytes | 46 | 48,577,731 | 0 |
| 1 | 0 | Page, geotiff direct | 46 | 48,577,731 | 0 |
| 2 | 100 | Workers | 47 | 48,577,731 | 0 |
| 2 | 100 | Page, shared bytes | 46 | 48,577,731 | 0 |
| 2 | 100 | Page, geotiff direct | 46 | 48,577,731 | 0 |
| 3 | 100 | Workers | 47 | 48,577,731 | 0 |
| 3 | 100 | Page, shared bytes | 46 | 48,577,731 | 0 |
| 3 | 100 | Page, geotiff direct | 46 | 48,577,731 | 0 |
| 4 | 100 | Workers | 47 | 48,577,731 | 0 |
| 4 | 100 | Page, shared bytes | 46 | 48,577,731 | 0 |
| 4 | 100 | Page, geotiff direct | 46 | 48,577,731 | 0 |
| 5 | 200 | Workers | 47 | 48,577,731 | 0 |
| 5 | 200 | Page, shared bytes | 46 | 48,577,731 | 0 |
| 5 | 200 | Page, geotiff direct | 46 | 48,577,731 | 0 |

Per phase with workers, as fetches and bytes:

| Run | RTT ms | Open | Outbound | Back |
|---|---:|---|---|---|
| 1 | 0 | 19, 20,266,179 | 26, 28,311,552 | 0, 0 |
| 2 | 100 | 20, 20,266,179 | 27, 28,311,552 | 0, 0 |
| 3 | 100 | 20, 20,266,179 | 27, 28,311,552 | 0, 0 |
| 4 | 100 | 20, 20,266,179 | 25, 26,214,400 | 2, 2,097,152 |
| 5 | 200 | 20, 20,266,179 | 20, 20,971,520 | 7, 7,340,032 |

Pan timings and the pool's counters with workers, after the return pan. "Settle" is the time from the last camera move to `whenIdle`. "Cancelled" counts queued jobs dropped, "orphaned" running jobs whose callers left, "kept" and "used" late results.

| Run | RTT ms | Outbound ms | Settle ms | Back ms | Settle ms | Dispatched | Cancelled | Orphaned | Kept | Used |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 2,308 | 38 | 1,801 | 46 | 81 | 0 | 0 | 0 | 0 |
| 2 | 100 | 1,614 | 1,266 | 1,892 | 42 | 81 | 4 | 4 | 4 | 4 |
| 3 | 100 | 1,649 | 1,249 | 1,889 | 42 | 81 | 5 | 4 | 4 | 4 |
| 4 | 100 | 1,649 | 1,033 | 1,924 | 42 | 81 | 5 | 4 | 4 | 4 |
| 5 | 200 | 1,564 | 2,616 | 1,748 | 53 | 81 | 10 | 14 | 14 | 10 |

Settle times on the page, for comparison:

| Run | RTT ms | Page, shared bytes | Page, geotiff direct |
|---|---:|---|---|
| 1 | 0 | 40 and 46 | 39 and 43 |
| 2 | 100 | 1,198 and 41 | 1,220 and 41 |
| 3 | 100 | 1,134 and 41 | 1,215 and 39 |
| 4 | 100 | 1,131 and 42 | 1,217 and 43 |
| 5 | 200 | 3,397 and 45 | 3,911 and 40 |

## Interpretation

- The mechanism of the POC regression reproduces with our reader when cancelling a tile cancels its download and nothing keeps the bytes: 160 fetches, no bytes delivered and no tile finished after 40 frames. The pool, which keeps started work, finished with one fetch. The POC's own numbers come from a different slide and scheduler and are not comparable one to one.
- A real pan on CMU-1.svs through the route has no fetch storm on any path, and no byte was downloaded twice in any of the 15 runs. Viv's tile layer does not re-ask every frame, so the VIEW-002 path did not storm either. The pool keeps that property while moving decoding off the page.
- The pool did use late results on the way back at 100 and 200 ms RTT, which is the case the POC lost.
- The bytes are fixed by the 1 MiB block size, not by the setup, so all three setups downloaded exactly the same 48,577,731 bytes. Assumption: the tiles in view need much less, because one block holds many tiles. TODO: count the tile byte counts of the tiles read during the pan to measure the over-read.
- Settling after the outbound pan at 200 ms RTT was faster with workers (2,616 ms) than on the page (3,397 and 3,911 ms) in the one run made. One run is not enough to call it a difference.

## Follow-ups

- [ADR 0105](../adr/0105-decode-workers-behind-one-byte-cache.md) records the pool design and relies on this file.
- TODO: measure the longest main-thread frame during a pan with and without workers on a 1024-tiled slide, to compare with POC doc 06 (598 ms before, 18 ms after).
- TODO: measure smaller block sizes against the bytes above.
