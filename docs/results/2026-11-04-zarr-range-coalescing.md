# Result: range coalescing brings a sharded OME-Zarr viewport from 72 requests to 12

- Date: 2026-11-04
- Backlog: TILES-005 (coalesce adjacent inner-chunk byte ranges when reading OME-Zarr 0.5 sharded stores)
- Kind: benchmark
- Commit: the TILES-005 commit on top of 239354a7
- Environment: MacBook, macOS 15 (Darwin 24.6.0), Node 26.13.0 with its built-in `fetch`, zarrita 0.7.5, the TILES-006 latency proxy (the latency proxy test harness) at 20 ms RTT with unlimited bandwidth
- Data: two synthetic stores written by `test/pixel-source/zarr-fixture.ts` into a temp folder, no PHI

## Question

Doc 32 of the POC (JPEG chunks, sharding over a slow link, and 16-bit data) read one 4096 square region of tumor_009 in 194 requests as Zarr v2, 219 as sharded Zarr v3 and 39 as sharded Zarr v3 with zarrita's `withRangeCoalescing`. Does the Parfocal OME-Zarr reader get the same drop when it reads a viewport of an OME-Zarr 0.5 sharded store?

## Method

`pnpm --filter @parfocal/viewer-engine exec node --test test/pixel-source/zarr-range-coalescing.test.ts`

- Both stores are 2048 by 2048 pixels, RGB uint8, one level, inner chunks of 3 by 256 by 256 with all channels in one chunk, raw `bytes` codec and no compression. The plain store has one object per chunk. The sharded store groups 4 by 4 inner chunks into one shard object with the index at the end (`index_codecs` is `bytes` only, no crc32c), so the viewport covers 64 inner chunks in 4 shards.
- The viewport is the whole level, `[0, 0, 2048, 2048]`, so every shard is read in full, as most of doc 32's shards were.
- The stores are served by `test/pixel-source/serve.ts` behind the latency proxy. Each arm opens the store first, then resets the proxy counters, then reads, so metadata reads are not counted. Each arm uses a fresh open, because zarrita caches shard indexes per array.
- "Before" is a bare zarrita `FetchStore` with `zarr.get` over the window, which is what the Parfocal reader did before this change and what doc 32's probe did. "After" is `openOmeZarrSource(...).getRaster(...)` with the store wrapped in `withRangeCoalescing` (default 32 KiB gap). The tile path asks for all 64 tiles with `getTile` in one `Promise.all`.

## Results

| Arm | Requests | HEAD | GET | Bytes at the proxy |
|---|---:|---:|---:|---:|
| Plain store, bare zarrita | 64 | 0 | 64 | 12,582,912 |
| Sharded store, bare zarrita (before) | 72 | 4 | 68 | 12,583,936 |
| Plain store, Parfocal reader | 64 | 0 | 64 | 12,582,912 |
| Sharded store, Parfocal reader, `getRaster` (after) | 12 | 4 | 8 | 12,583,936 |
| Sharded store, Parfocal reader, 64 `getTile` calls together (after) | 12 | 4 | 8 | 12,583,936 |

The pixel at (1500, 777) in the green plane read back as 152 in every arm, the fixture's value. The sharded fixture also passes the PixelSource conformance suite.

## Interpretation

- The drop has the same shape as doc 32. Sharding alone adds 2 requests per shard for its index, a HEAD and a ranged GET, so 64 becomes 72, as 194 became 219. Coalescing folds each shard's 16 inner-chunk ranges into one GET, so 72 becomes 12, which is 3 per shard. Doc 32's 39 was 12 shards at 3 each plus 3 metadata reads. Here the ratio to the plain store is 64 to 12, 5.3 times, against doc 32's 194 to 39, 5.0 times.
- Bytes do not change. Coalescing only fetches the gap between ranges, and a fully covered shard has none.
- Concurrent `getTile` calls coalesce as well as one `getRaster`, because zarrita resolves each tile's cached shard index and reaches `getRange` within the same microtask. This holds when the tiles are asked for in one tick. The tile scheduler in the browser was not measured.
- Node's `fetch` has no six-connection limit, so wall time here does not show the head-of-line blocking that doc 32 measured in a browser, and no time is claimed.
- Plain and unsharded stores are unchanged, because zarrita reads their chunks with `get`, which the coalescer passes through.

## Follow-ups

- Done on 2026-11-09 under VIEW-063 (sharded OME-Zarr through the byte cache). The reader now opens `FetchStore` with `useSuffixRequest`, which sends one `bytes=-N` range for each shard index and no HEAD. The same test then counted 8 requests, all GET, for both the `getRaster` arm and the 64 `getTile` arm, which is 2 per shard, with the same 12,583,936 bytes. The edge tile gateway already answers a suffix range with 206 (`apps/edge/test/tiles.test.ts`, "suffix and open ended ranges skip the cache"), and `serve.ts` accepts them now. The HEAD was more than a wasted request: the byte cache and the worker relay forward only the URL and the Range header, so through them it became a GET of the whole shard with no length, the index was read from the wrong bytes, and the tile read never finished.
- TODO: measure the request count of a real pan in the browser once a sharded OME-Zarr slide is in the fixture set.
