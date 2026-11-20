# Where the tile time goes on the Philips-3.tiff slide

Measured on 2026-11-20 on app.parfocal.eu for backlog task PROTO-130 (tile range requests on the deployed app answer fast enough for a smooth pan), signed in as the agent test account through `scripts/agent_session.py`. The slide is Philips-3.tiff in the project Scanner format comparison. Headless Chromium on the owner's Mac at 1440 by 900 opened it, waited 12 seconds, zoomed in with 12 wheel steps and made 16 drag pans. Nothing in production was changed and nothing was spent.

## The file

`original.tiff` is a BigTIFF of 3305342358 bytes with JPEG tiles of 512 by 512 pixels in nine levels, from 131072 by 100352 down to 512 by 512, plus a label and a macro image. The median tile is 35779 bytes at full resolution and 41154 to 76080 bytes in the lower levels, and the largest is 175170 bytes. Tiles are not stored in row order.

## How the time was split

A script hooked the page and the six decode workers. On the page it timed each `read` sent to a worker and each tile that came back, which is exactly the overlay's decode time (dispatch to settle), and each byte request a worker relayed and its reply. In each worker it timed each byte request sent, each reply turned into a `Response` and each tile posted back. Playwright logged every range request with its `Range` header and timing, and Resource Timing gave the edge's `Server-Timing`. Worker and page times share `performance.timeOrigin`.

In one run with developer mode turned on from the palette, the overlay showed decode p95 714.3 ms and the script's dispatch to settle p95 for the same run was 714 ms, so the two measure the same thing. That run drew a lab layer and read only 17 tiles, so it is not in the tables below.

## The parts, on the deployed bundle with 1 MiB blocks

Two runs on the deployed v0.29.1 bundle, 98 and 105 tiles.

| Part | p50 | p95 |
| --- | --- | --- |
| Dispatch to settle (the overlay's decode time) | 215 and 190 ms | 556 and 332 ms |
| First byte asked to last byte back, per tile | 168 and 149 ms | 536 and 282 ms |
| Range request in the browser, whole | 180 and 134 ms | 333 and 434 ms |
| Of that, waiting for the first byte | 28 and 40 ms | 94 and 101 ms |
| Of that, downloading the body | 134 and 86 ms | 310 and 382 ms |
| Edge cache lookup in the Worker | 4 and 6 ms | 6 and 10 ms |
| Relay, worker to page | 0.2 and 12 ms | 34 and 42 ms |
| Relay, page to worker | 0.1 and 0.1 ms | 0.3 and 0.4 ms |
| Decode after the last byte arrived | 8 and 10 ms | 14 and 16 ms |

Every range request the browser reported was an edge cache hit. A direct probe of 6 cold ranges at each size gave an R2 read of 69 to 82 ms at 64 KiB and 74 to 138 ms at 1 MiB inside the Worker, and the same ranges asked again were hits with a lookup of 3 to 8 ms.

The second run fetched 40 ranges and 40.8 MB, almost all whole 1 MiB blocks, while the workers asked for 12.5 MB inside them. So the largest part is downloading block bytes that no tile needs. Decode, the relay and the edge are small. Workers fetching their own bytes would save at most the relay's 42 ms p95 and would lose the one shared block cache of ADR 0105 (decode workers behind one byte cache).

A replay of the second run's 221 byte asks through the cache logic, computed and not timed, gave these totals.

| Block | Range requests | Requests holding more than one block | Bytes |
| --- | --- | --- | --- |
| 64 KiB | 109 | 78 | 14.7 MB |
| 128 KiB | 92 | 30 | 16.6 MB |
| 256 KiB | 68 | 11 | 21.0 MB |
| 512 KiB | 47 | 6 | 27.8 MB |
| 1 MiB | 38 | 1 | 40.9 MB |

The 1 MiB row matches the 40 requests and 40.8 MB measured.

## Before and after

Three builds of this branch for production, with the page's range cache block at 1 MiB, 256 KiB and 128 KiB and the cache holding 100 MiB in each, were served in place of the deployed assets against the same API, edge and data. The runs were interleaved in three rounds. In round 1 the 256 and 128 KiB blocks were new edge keys, so 13 of 16 and 17 of 20 reported requests were R2 reads. Rounds 2 and 3 were warm for every size.

| Run | Tiles | Range requests | MB fetched | Request p50 | Request p95 | Dispatch to settle p50 | Dispatch to settle p95 | Bytes phase p95 | Decode p95 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 MiB, round 1 | 102 | 39 | 39.8 | 237 ms | 398 ms | 259 ms | 471 ms | 421 ms | 19 ms |
| 256 KiB, round 1, cold edge | 105 | 65 | 20.9 | 140 ms | 277 ms | 251 ms | 468 ms | 456 ms | 19 ms |
| 128 KiB, round 1, cold edge | 101 | 90 | 15.9 | 107 ms | 274 ms | 269 ms | 449 ms | 433 ms | 17 ms |
| 1 MiB, round 2 | 105 | 40 | 40.8 | 196 ms | 307 ms | 182 ms | 325 ms | 287 ms | 14 ms |
| 256 KiB, round 2 | 105 | 67 | 20.9 | 83 ms | 284 ms | 147 ms | 302 ms | 282 ms | 14 ms |
| 128 KiB, round 2 | 112 | 98 | 17.9 | 62 ms | 148 ms | 154 ms | 339 ms | 330 ms | 16 ms |
| 1 MiB, round 3 | 105 | 39 | 40.8 | 157 ms | 426 ms | 197 ms | 398 ms | 304 ms | 17 ms |
| 256 KiB, round 3 | 105 | 70 | 20.9 | 78 ms | 254 ms | 156 ms | 362 ms | 315 ms | 14 ms |
| 128 KiB, round 3 | 105 | 93 | 16.6 | 50 ms | 207 ms | 182 ms | 364 ms | 325 ms | 15 ms |

With a warm edge, 256 KiB blocks halve the bytes, cut the range request p50 from 157 to 196 ms down to 78 to 83 ms and the dispatch to settle p50 from 182 to 197 ms down to 147 to 156 ms. The p95 moved from 325 to 398 ms to 302 to 362 ms. 128 KiB blocks fetched a further 3 MB less but made about 40 percent more requests, a third of them spanning two blocks, with no better dispatch to settle. So the cache now reads 256 KiB blocks.

## What changed

`packages/viewer-engine/src/decode/range-cache.ts` reads in `defaultRangeBlockSize` blocks of 256 KiB and keeps `defaultCachedBytes`, 100 MiB, which is now 400 blocks. geotiff's own block size, `TIFF_BLOCK_SIZE` in `directory.ts`, is unchanged. The test in `packages/viewer-engine/test/decode/range-cache.test.ts` checks the aligned 256 KiB requests a small tile read makes and the 100 MiB budget.

A pan of this length makes about 70 range requests instead of 40. The account is on Workers Free with 100,000 requests a day, so this is about 1400 such pans a day before the cap, against about 2500 before.

## Still open

- After the change the per tile bytes phase is still most of the dispatch to settle time, with up to 4 byte asks per tile. Whether those asks run one after another, and so cost a round trip each, was not measured. TODO.
- The owner's 870.4 ms decode p95 and the 1419 ms range p95 of the cells slide lag run (PROTO-128, the AI cell outlines fix) were not reproduced. The runs here peaked at 556 ms with a warm edge from the owner's Mac. A cold edge, a slower link or a busier main thread could explain the rest, but none was measured. TODO.
- Requests that hold more than one block have a length that depends on what the client already holds, so they repeat less often across users at the edge. At 256 KiB that was 11 of 68 requests in the replay.

## Do a tile's byte requests run in sequence (PROTO-132)

Measured on 2026-11-20 for backlog task PROTO-132 (a tile's byte requests run together, not one after another), on a local fixture and not on the deployed app. The test file is `packages/viewer-engine/test/decode/tile-requests.test.ts`. It builds a classic TIFF in memory with 400 uncompressed 16 by 16 tiles whose `TileOffsets` array sits after the tile data, so geotiff leaves it deferred as it does for a large level of a real slide. The file is read through `createRangeCache` with 4 KiB blocks and a fake fetch that waits 40 ms and records each request's start and end. The fixture is not the deployed slide and 40 ms is a chosen round trip, so only the count and the overlap carry over, not the milliseconds.

Cause: geotiff's `getTileOrStrip` awaits the tile's offset, then its byte count, then the bytes. The byte counts are already loaded when a slide opens, but a large level's offsets are looked up per tile, and the bytes cannot be asked for before the offset is known. So the first read of a tile in a block of offsets that is not held makes 2 requests, one after the other.

| Build | Requests for the first tile after opening | Overlap | Time from read to tile |
| --- | --- | --- | --- |
| Before | 2 (offsets block 102400-106495, then tile block 20480-24575) | none, the second started at 252.1 ms and the first ended at 251.4 ms | 87.5 ms |
| After | 1 (tile block 20480-24575) | not applicable | 46.4 ms |

With the offsets read straight after opening, the offsets request is one request for the slide and three tiles in distinct blocks make 4 requests in all, the three tile requests running together.

## What changed for PROTO-132

`packages/viewer-engine/src/pixel-source/tiff/tiff-source.ts` loads each level's whole `TileOffsets` array once, in the background as soon as the slide opens, and a read waits for that load of its level (and of its channel pages) before decoding. The array is 8 bytes a tile, about 400 KB for the 131072 by 100352 level of Philips-3.tiff, 256 KiB blocks around the first offset lookup were already fetched, and the cost is one more request of that size per level once per slide, against about 20 MB for a pan. After it a tile waits for one round trip, the one for its own bytes. A failed load is ignored and the tile falls back to the per tile lookup.

The three tests in `tile-requests.test.ts` cover one request per tile after the offsets are held, a single offsets request when tiles are read straight after opening, and three distinct tile blocks asked for together within 1.8 round trips.

## Still open for PROTO-132

- The deployed app was not measured, before or after, because the new build is not deployed and serving a local build against the deployed API was not done. Philips-3.tiff has a 400 KB offsets array at the top level, above the 64 KiB limit for priming from the slide index, so it should show the same two step pattern, but that is reasoned, not measured. TODO.
- The up to 4 requests per tile seen in PROTO-130 are tile bytes that span or skip cached blocks, which the range cache already asks for together, so they do not add round trips.
