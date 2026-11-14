# Result: the tile delivery choice of STACK-025 holds against Cloudflare's documentation, and the numbers still missing belong to TILES-002

- Date: 2026-11-14
- Backlog: TILES-000 (research check for tile delivery)
- Kind: spike
- Commit: documentation only, on top of 968fd2fd
- Environment: no code run and no cloud call. Cloudflare documentation pages read on 2026-11-14, linked per claim
- Data: none. Measured numbers are quoted from [the gateway latency spike](2026-11-02-tile-gateway-latency.md) and [the same-origin comparison](2026-11-03-same-origin-slide-bytes.md)

## Question

Does the choice of STACK-025 (object storage, CDN and signed access) still hold: R2 behind a Worker gateway with capability tokens ([ADR 0003](../adr/0003-pilot-platform-architecture.md), pilot platform architecture, and [ADR 0137](../adr/0137-capability-tokens-for-slide-bytes.md), capability tokens for slide bytes), and a Cache API layer keyed per object and byte range? The task asks for it to be confirmed with measured CDN numbers. TILES-001 (signed access), TILES-003 (same-origin data path) and the gateway spike are done, so this check only tests their assumptions against sources and names what is still unmeasured.

## Method

Read the Cloudflare pages below and compared each claim with what `RangeCache` in `apps/edge/src/tiles.ts` and the two result files already did and measured. No bucket, Worker or production system was touched.

## Results

| Assumption in the repository | What the source says | Holds |
|---|---|---|
| `cache.put` refuses a 206, so each range is stored as a synthetic 200 under a tokenless key | "`cache.put` throws an error if the response has a 206 status" and `cache.match` can answer a Range request from a stored response that has a Content-Length ([Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)) | Yes |
| The cached copy needs `public` in `Cache-Control` | `cache.put` returns 413 if `Cache-Control` says not to cache ([Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)) | Yes |
| Layer works on `workers.dev` | The page lists no `workers.dev` restriction for the cache and says functional operations exist on custom domains. Only the redirect rule of `put()` does not apply there ([Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)). The spike measured hits on `workers.dev` | Yes, and measured |
| A hit costs about 10 ms in the Worker | The cache is per data centre: "the contents of the cache do not replicate outside of the originating data center", and `cache.delete` purges only the data centre that ran the Worker ([Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)). So a hit rate depends on how many colos serve the viewers | Holds per colo only |
| Tiered caching can be left out | "The `cache.put` method is not compatible with tiered caching" ([Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/)). Smart Tiered Cache applies to caching in front of a public custom domain, not to this layer ([R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)) | Yes, a limit to accept |
| Stale ranges after an overwrite of the same key (spike follow-up) | R2 is strongly consistent through the binding, but through a caching domain "the old (previous) object will continue to be served to clients until the cache TTL expires", and a deleted cached object stays available. "The cache does not affect access via Worker API bindings" ([R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)). The Worker cache is not the binding, so the risk is real | Needs a version in the key |
| Range reads through the binding | `get()` takes offset with length, or a suffix, and `R2ObjectBody` exposes `range`, `size` and `httpEtag` ([R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)) | Yes |
| Presigned reads are not an option | Public `r2.dev` URLs have no caching or WAF and are "rate-limited and should only be used for development" ([R2 public buckets](https://developers.cloudflare.com/r2/buckets/public-buckets/)). A custom domain gets Cloudflare Cache, but "by default, only certain file types are cached" and Cache Everything is needed for the rest | Yes |
| HTTP/3 at the edge | "HTTP/3 is available to all plans" ([HTTP/3](https://developers.cloudflare.com/speed/optimization/protocol/http3/)). The page does not say it is on by default, so TILES-002 must check the zone setting | Open, check the zone |
| Cost stays inside $30 a month | R2 egress is free, Standard storage $0.015 per GB-month, Class B reads $0.36 per million with 10 million free ([R2 pricing](https://developers.cloudflare.com/r2/pricing/)). Subrequests are not billed ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)) | Yes |

Limits that matter at the gateway ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)):

| Limit | Free | Paid |
|---|---|---|
| Subrequests per invocation | 50 | 10,000 |
| Cache API calls per request | 50 | 1,000 |
| CPU time per HTTP request | 10 ms | 30 s default |
| Requests | 100,000 a day | 10 million a month included, then $0.30 per million ([pricing](https://developers.cloudflare.com/workers/platform/pricing/)) |

Measured numbers already on record, client wall time from a home network in Europe over HTTP/1.1 to the AMS colo ([gateway spike](2026-11-02-tile-gateway-latency.md)).

| Arm | Warm p50 | Warm p95 |
|---|---|---|
| SVS range, no cache | 99.3 ms | 159.3 ms |
| SVS range, cache hit | 49.2 ms | 65.5 ms |
| Chunk, no cache | 113.2 ms | 157.5 ms |
| Chunk, cache hit | 54.5 ms | 73.3 ms |

Same origin ([same-origin comparison](2026-11-03-same-origin-slide-bytes.md)): 0 preflights against 63, and a 0.63 s open against 1.27 s at 100 ms RTT.

## Interpretation

- STACK-025 is confirmed. No source contradicts the gateway with the binding and the tokenless range cache.
- The cache numbers are the measured part. The budget of TILES-002 (warm p95 under 60 ms in the same region) is not yet confirmed. The measured p95 is 65.5 and 73.3 ms from a client that was not in the colo's region and used HTTP/1.1. The Worker's own share was about 10 ms, so the remainder is network, which is an assumption until measured.
- Three things in the sources are not covered by a measurement yet. A hit is per data centre, so the first view from each new colo is a miss, and the spike ran from one colo. An overwrite is served stale until the max age of one day, so the key needs a version. The Free plan's 10 ms CPU limit is tight for a gateway that verifies a signature and copies bodies, and the spike ran on Free without hitting it.
- The numbers claimed here come from earlier runs. Nothing new was measured, because the rules of this run allow no cloud calls.

## Follow-ups

- TILES-002 (CDN in front of slide storage) should measure from a client in the same region over HTTP/2 and HTTP/3 on the `parfocal.eu` custom domain, include a hit from a second colo, put a version or ETag in the cache key, and check the HTTP/3 zone setting.
- TODO for the owner's production step: any measurement on the real zone is a production read of settings and a deploy, which ADR 0151 (standing approval within $30 a month) covers when it only adds.
- No new ADR. The decision stays as ADR 0003 made it.
