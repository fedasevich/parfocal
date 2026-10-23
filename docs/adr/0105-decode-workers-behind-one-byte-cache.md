# 0105. Six decode workers read the slide through one byte cache on the page and never drop work that has started

- Date: 2026-10-23
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: VIEW-004 (decode worker pool). Touches VIEW-002 (Viv route on WebGL2 for RGB brightfield), VIEW-005 (native JPEG decode), VIEW-006 (shared decode cache across channels), VIEW-041 (how a slide loads), VIEW-036 (renderer interface) and TILES-006 (latency proxy test harness).

## Context

VIEW-004 asks for six decode workers by default, transferable buffers, priority by distance to the viewport centre, and cancellation of queued work only, never of completed downloads. Its "Done when" line names the POC regression of doc 06 note 11, where a scheduler dropped every chunk that landed after a newer frame and a slow BigTIFF produced 10,324 fetches and 7.7 GB instead of 19 and 14 MB.

Before this change the Viv route ([ADR 0102](0102-viv-route-feeds-a-virtual-rgb-ladder.md)) read every region on the page. geotiff fetched the bytes, decoded JPEG in JavaScript, converted YCbCr, and the route box-averaged the result, all on the main thread. POC doc 06 measured a nine-tile viewport of a Ventana BIF at 638 ms of main-thread work arriving as one 598 ms frame, and ADR 0102 asked VIEW-004 to move the box average with the decode.

A geotiff handle owns its fetch state and block cache and cannot be transferred, so a worker that decodes has to either open the slide itself or receive bytes from the page. geotiff reads in 1 MiB blocks ([ADR 0099](0099-tiff-and-zarr-readers-in-the-browser.md)), and one block of CMU-1.svs holds dozens of 256-pixel JPEG tiles, so neighbouring tiles share blocks.

## Options considered

Where the work runs:

1. Each worker opens the slide with its own geotiff source and block cache, as the POC did (`poc/src/viv/plane-worker.ts`). Simple, and every pixel step leaves the page. But six independent block caches download a shared block up to six times, and each worker may hold geotiff's default 100 blocks.
2. The page fetches and assembles, and workers only decode compressed tiles, through geotiff's `Pool` or our own. The network stays in one place. But window assembly, the YCbCr conversion in `readRGB` and the box average stay on the main thread, and geotiff's `Pool` has neither priority nor cancellation.
3. Each worker opens the slide with our own `PixelSource` and runs the whole region read, decode, conversion, box average and interleave. Its byte requests go over a `MessagePort` to one range cache on the page, which holds 1 MiB blocks, joins concurrent requests for the same block and never aborts a download. The pixels are produced by the same code as before, so they are identical, and the slide is downloaded once. The costs are one message per byte request and an IFD walk in each worker, and both are CPU only.

What a cancelled tile does:

1. Cancel everything, including a decode or download that has started. This is the POC regression whenever a request outlives a frame.
2. Remove a job from the queue when every caller has gone, let a started job finish, and keep its result. The next request for the same region gets the kept result, and a request for a region already in flight joins it.

Priority:

1. First in, first out.
2. The queued job whose centre, in level 0 pixels, is nearest the camera centre, decided when a worker becomes free, so a pan reorders what is still waiting.

## Decision

Option 3 for where the work runs, option 2 for cancellation and option 2 for priority.

- `src/decode/decode-pool.ts` is the scheduler. It runs one job per worker, six by default (`defaultDecodeWorkers`), and takes `size` as an option. It keys jobs by region, joins identical requests, drops a queued job when its last caller aborts, never cancels a running job, and keeps up to 32 results that finished with no caller left (`defaultRetainedResults`), handing each to the next request for the same region.
- `src/decode/range-cache.ts` is the byte cache on the page. It answers `bytes=a-b` requests from 1 MiB blocks, fetches each run of missing blocks with one request, shares a block that is already downloading, keeps the 100 most recently used blocks (the size of geotiff's own default cache) and never passes an abort signal to the network. Requests without a byte range, such as Zarr chunks, pass through with their status and are shared while in flight.
- `src/decode/worker-runtime.ts` and `src/workers/decode.worker.ts` open the slide with the default registry and a `fetch` that relays to the page (`src/decode/byte-relay.ts`). Each reply carries one interleaved RGB tile, and its buffer is transferred, not copied.
- `createPixelSlideOpener` now gives every slide a range cache and opens the page's own source through it, so the page and the workers share the bytes. `OpenRequest.fetch` is now honoured by both the TIFF and the Zarr source, and the TIFF source skips geotiff's block cache when a fetch is given.
- The Viv route starts a pool for every slide that carries its open request, sets the pool's focus on every camera change, includes the pool in `whenIdle`, and takes `decodeWorkers` (0 reads on the page as before) and `spawnDecodeWorker` options. A pool disposed during a slide switch rejects with Viv's abort sentinel, so no tile error is reported.

Six matches the POC, where the Viv and WebGPU routes both decoded in six workers, and the same number for every route keeps VIEW-039 (renderer head-to-head benchmark) fair. Chrome also opens at most six HTTP/1.1 connections to one host, so more workers would wait on the network anyway.

The [result](../results/2026-10-23-decode-pool-pan-fetches.md) has the numbers. A caller that cancels and re-asks every unfinished tile each 16 ms frame, over a 60 ms proxy, never finished four tiles in 40 frames and started 160 fetches when cancelling a tile cancelled its download, and finished in 6 frames with one fetch through the pool. A 90-frame pan across CMU-1.svs at 10x and back, through the latency proxy at 0, 100 and 200 ms RTT, took 45 to 47 fetches and 48,577,731 bytes on every path, and no byte was downloaded twice.

## Consequences

- Viv's `getTile` and `getRaster` on the main thread now only post a message and wait. The box average of the coarsest virtual levels runs in a worker.
- The CMU-1.svs goldens now render through the pool and still match, and `viv-cmu1.spec.ts` checks that they used six workers.
- Network requests from the viewer are never aborted. A tile the user pans away from still finishes downloading, which is the point, and costs at most one 1 MiB block per request.
- VIEW-005 (native JPEG decode) runs inside the worker, where `createImageBitmap` is available, and keeps returning RGB.
- VIEW-006 (shared decode cache across channels) may already hold, because the route asks for one interleaved tile per region and the pool joins identical regions. TODO: check its "Done when" line against the pool's `dispatched` count before ticking it.
- VIEW-041 (how a slide loads) can read the pool's queue and late counts for its "tiles left" hint.
- VIEW-036 (renderer interface) should carry the decode pool and `whenIdle` into the shared interface, so the WebGPU routes use the same pool.
- Every fetch is whole 1 MiB blocks, so the pan above downloads 48.6 MB. TODO: count the tile bytes the pan really needs (the byte counts of the tiles it reads) to know how much the block size over-reads, then try smaller blocks or the tile offsets of INGEST-007 (sidecar tile index) before the pilot.
- TODO: measure the longest main-thread frame during a pan with and without the pool on a 1024-tiled slide, to compare with POC doc 06 (598 ms before, 18 ms after). This change does not measure it.
