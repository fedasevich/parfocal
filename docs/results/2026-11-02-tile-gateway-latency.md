# Result: tile fetch latency through the Worker gateway, with and without a Cache API layer

- Date: 2026-11-02
- Backlog: STACK-025 (object storage, CDN and signed access)
- Kind: spike
- Commit: the STACK-025 commit, measured from the working tree on top of 3ff56c1
- Environment: MacBook on the owner's home network in Europe, Node 26.13 `fetch` (HTTP/1.1 with keep-alive, one request at a time). Worker `parfocal-edge-spike` on `workers.dev`, `compatibility_date` 2026-10-01, Workers Free plan, served from the AMS colo for every request. R2 bucket `parfocal-dev` with location hint `eeur`
- Data: `CMU-1.svs` (177,552,579 bytes, public OpenSlide test slide) and 30 objects of 196,608 bytes cut from its bytes, all under `t/spike/s/spike/` in `parfocal-dev`, deleted after the run

## Question

How long a tile fetch takes through the gateway of ADR 0137 (capability tokens for slide bytes), cold and warm, for SVS byte ranges and for OME-Zarr sized chunks, with and without a Cache API layer keyed per object and byte range. The budget is TILES-002 (CDN in front of slide storage): warm tile fetch p95 under 60 ms in the same region.

## Method

1. `apps/edge/src/tile-spike.ts` wraps `handleTiles` and turns the cache layer on when a request carries `X-Spike-Cache: on`. The layer is the optional `RangeCache` argument of `handleTiles` in `apps/edge/src/tiles.ts`. It stores each range as a 200 response under a tokenless key built from the object key, offset and length, and rebuilds the 206 on a hit. The Worker reports `Server-Timing` for the R2 read and the cache lookup.
2. Deployed with `npx wrangler deploy -c apps/edge/spike/tile-latency.wrangler.jsonc` and a fresh random `TILE_TOKEN_KEY`.
3. 400 tile byte ranges of level 0 of `CMU-1.svs` over 8,000 bytes (median 25,293 bytes) were read from its TIFF tile table with `tifffile` and shuffled with seed 7.
4. `node apps/edge/spike/tile-latency.ts --url BASE --key KEYFILE --ranges RANGES --raw RAW` ran one isolate warm-up request, then four arms in order. Each SVS arm read 100 ranges never read by that arm (cold), then 20 of them 5 times (warm). Each chunk arm read 15 whole objects once (cold), then the same 15 five times (warm). Every response's length was checked against the expected length, and one cached range was compared byte for byte with the local file.
5. The Worker and all 31 objects were deleted afterwards. About 600 requests, cost $0.

There is no OME-Zarr in the bucket or the repository, so the chunk arm used objects of the size of a 256 by 256 RGB uint8 chunk at flat keys.

## Results

Times are client wall time in milliseconds, from sending the request to having the whole body. R2 and cache columns are the Worker's own `Server-Timing` medians.

| Arm | Phase | n | p50 | p95 | R2 read p50 | Cache lookup p50 | Cache |
|---|---|---|---|---|---|---|---|
| SVS range, no cache | cold | 100 | 164.7 | 409.7 | 116 | | |
| SVS range, no cache | warm | 100 | 99.3 | 159.3 | 59 | | |
| SVS range, cache | cold | 100 | 132.0 | 271.9 | 73 | 9 | miss |
| SVS range, cache | warm | 100 | 49.2 | 65.5 | | 10 | hit |
| Chunk, no cache | cold | 15 | 219.2 | 288.8 | 170 | | |
| Chunk, no cache | warm | 75 | 113.2 | 157.5 | 65 | | |
| Chunk, cache | cold | 15 | 313.2 | 612.1 | 251 | 11 | miss |
| Chunk, cache | warm | 75 | 54.5 | 73.3 | | 10 | hit |

The first request to a fresh isolate took 344.9 ms.

## Interpretation

- Without the cache, warm p95 is 157 to 159 ms, about 2.5 times the TILES-002 budget, and the R2 read alone takes about 60 ms at the median.
- With the cache, warm p95 is 65.5 ms for SVS ranges and 73.3 ms for chunks, close to the budget, and the Worker's own time on a hit is about 10 ms. The rest is the network between this client and AMS over HTTP/1.1, which is not "the same region" of the budget. A client in the colo's region on HTTP/2 or HTTP/3 should be lower, but that is an assumption until TILES-002 measures it.
- The cache miss costs one extra lookup of about 10 ms. The cold chunk arm with the cache was slower than without it, but with 15 samples per arm the gap is within the R2 read time spread, so it is not read as a cost of the cache.
- The Cache API works on `workers.dev`, and `cache.put` accepts the synthetic 200, so the layer needs no custom domain.
- Conclusion: the cache layer is needed for the TILES-002 budget. The decision itself was already made by ADR 0003 (pilot platform architecture), which says to add the layer when latency exceeds that budget, so no new ADR.

## Follow-ups

- TILES-002 (CDN in front of slide storage) turns the layer on in `apps/edge/src/index.ts` and measures warm p95 from the same region over HTTP/2 or HTTP/3.
- The gateway accepts only one path segment after the slide, so nested OME-Zarr keys such as `0/0.0.0` are refused. TODO for the task that first serves OME-Zarr through the gateway.
- Cached ranges live until their max age of one day. An object rewritten under the same key would be served stale until then. TODO for TILES-002, for example a version in the key.
- COOP and COEP header injection on the app origin, named in ADR 0003's router, is not in `index.ts` yet. TODO for the routing task.
