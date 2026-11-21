# Result: on the deployed Philips-3.tiff, 103 of 109 tiles make one byte request, and the first tile of 5 of the 6 decode workers waits for two round trips

- Date: 2026-11-21
- Backlog: PROTO-132 (a tile's byte requests run together, not one after another)
- Kind: production measurement
- Commit: `ad05cea` (v0.35.12 as deployed on app.parfocal.eu), which holds `0788d045` (a level's tile offsets load once)
- Environment: MacBook with Apple M4 on a home connection in Europe, headless Chromium shell build 1248 at 1440 by 900 driven by Playwright 1.65.1, signed in as the agent test account
- Data: Philips-3.tiff in the seeded project Scanner format comparison, no PHI

## Question

The [tile request time result](2026-11-20-tile-request-time.md) (where the tile time goes on Philips-3.tiff) measured the sequential offset lookup only on a local fixture. Its before was 2 sequential requests for a tile's first read and its after was 1. How many byte requests does a tile make on the deployed slide, and do they run one after another?

## Method

1. An init script wrapped `Worker.prototype.postMessage`, `MessageChannel` and `MessagePort` on the page. It recorded each `read` sent to a decode worker, each `tile` that came back, and each byte request a worker relayed to the page's range cache and its reply, all on `performance.now()`. A worker's byte port was matched to the worker through the `open` message. A decode worker runs one read at a time, so every byte request between a read and its tile belongs to that tile.
2. Per tile it counted the byte requests and the longest chain of requests where one started only after an earlier one had answered. A "slow" request answered in more than 5 ms, which is a request that left the page's cache. Playwright logged every `Range` request the browser sent, with its timing.
3. The script opened the slide, waited 12 s, zoomed in with 12 wheel steps and made 16 drag pans, as in the earlier result. It ran twice.

No before was measured on the deployed app, because the change was already deployed and no older bundle was served.

## Results

| Run | Tiles | Byte requests | Tiles with 1 request | Tiles with 17 requests | Slow chain 0 | Slow chain 1 | Slow chain 2 | Tile p50 | Tile p95 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 105 | 201 | 99 | 6 | 23 | 77 | 5 | 169 ms | 286 ms |
| 2 | 109 | 205 | 103 | 6 | 24 | 80 | 5 | 105 ms | 403 ms |

| Run | Range requests in the browser | Overlapping another | Most at once |
|---|---:|---:|---:|
| 1 | 64 | 60 | 12 |
| 2 | 71 | 68 | 12 |

The 6 tiles with 17 requests are the first read of each of the 6 decode workers. In run 1 each of these reads first asked for 11 level offset arrays within 1.2 ms and two more offset blocks at about 30 ms, all answered from the page cache in 0.2 ms or less. Then each worker asked the same range, bytes 1,054,913,406 to 1,055,001,963 (88,558 bytes), twice at about 35 ms, and it answered after 24 to 27 ms. On workers 1 to 5 a second network request followed at 118 to 124 ms, a range of its own of 70 to 107 KB between bytes 3,304,368,205 and 3,304,883,007, and it answered after 191 to 197 ms. Those five ranges are contiguous. On worker 0 the matching request came at 137 ms, after its first tile had settled, so it belongs to its next read. Which part of the file the shared 88,558 byte range holds was not identified. Every byte request seen fell inside a read.

## Interpretation

- After the slide opens, every tile makes exactly one byte request, so a tile waits for at most one round trip. Byte requests across tiles run together, with up to 12 range requests in flight.
- The first tile of 5 of the 6 workers still waits for two network round trips in a row, 5 of 105 and 5 of 109 tiles. The first of the two is the shared 88,558 byte range, which every worker asks for at once. It is an opening cost, once per worker per slide. If that range is a tile offsets or directory block, the opening path still has the sequential lookup this task removes.
- Compared with the fixture's before of 2 sequential requests on a tile's first read, the steady state now matches the fixture's after.

## Follow-ups

- `TODO` identify the shared range at byte 1,054,913,406 of Philips-3.tiff from its IFDs. If it is an offsets or directory block, prime it with the slide's other offsets so the opening tiles wait for one round trip.
