# Result: the production Worker serves repeated tile ranges from the edge cache, measured locally behind the latency proxy

- Date: 2026-11-15
- Backlog: TILES-002 (CDN in front of slide storage)
- Kind: baseline
- Commit: the TILES-002 commit, measured from the working tree on top of 4ec6b2e8
- Environment: MacBook (Apple M4, 24 GB) shared with five other agents and a running `verify-changed.sh`, Node 26.13.1. `wrangler dev --local` (wrangler 4.161.0, workerd) with `apps/edge/spike/tile-cache-local.wrangler.jsonc`, so the real `src/worker.ts` route with local R2 on disk and the local Cache API. The latency proxy of TILES-006 (latency proxy test harness) in front, HTTP/1.1 with keep-alive, one request at a time
- Data: one 8,388,608 byte random object under a local bucket named `tile-cache-local`, nothing in any cloud bucket

## Question

Does the edge route now answer a repeated tile range from the Cache API, and what does a hit cost against a miss in the Worker, with the network added by the proxy? This does not answer the budget of TILES-002 (warm tile fetch p95 under 60 ms in the same region). Local R2 is a disk read, not the roughly 60 ms R2 read the [gateway spike](2026-11-02-tile-gateway-latency.md) measured, and the proxy is not Cloudflare's network.

## Method

1. Seeded the object with `wrangler r2 object put ... --local --persist-to` and a random 32 byte `TILE_TOKEN_KEY` passed with `--var`.
2. Ran `node apps/edge/spike/tile-cache-local.ts --key KEYFILE --rtt 0,20`. For each RTT it starts a proxy, sends one warm-up request, reads 60 distinct 25,000 byte ranges never read before (cold), then 20 of them 5 times (warm). Every response was checked for status 206 and 25,000 bytes. The outcome and the Worker's own time come from `Server-Timing`.

## Results

Client wall time in milliseconds. Worker p50 is the `r2` duration on a miss and the `cache` lookup on a hit.

| RTT | Phase | n | p50 | p95 | Worker p50 | Outcome |
|---|---|---|---|---|---|---|
| 0 | cold | 60 | 9.6 | 13.7 | 1 | all miss |
| 0 | warm | 100 | 7.0 | 10.1 | 2 | all hit |
| 20 | cold | 60 | 31.7 | 37.9 | 1 | all miss |
| 20 | warm | 100 | 29.0 | 33.0 | 2 | all hit |

## Interpretation

- Every warm request was a hit and every cold one a miss, so the layer is on in the production route, with the token kept out of the key.
- Locally a hit saves about 3 to 5 ms at p95, because the local bucket read is about 1 ms. In production the miss pays the R2 read of about 60 ms at the median from the gateway spike, so the saving there is larger. That is a reading of the earlier result, not a new measurement.
- At 20 ms RTT the warm p95 is 33 ms, so the Worker and proxy add about 13 ms over one round trip. Whether the real edge meets 60 ms depends on the RTT from a viewer in the colo's region and on HTTP/2 or HTTP/3, which only a production run can show.

## Follow-ups

- Owed for TILES-002 (CDN in front of slide storage): deploy, then measure warm p95 on `app.parfocal.eu` from a client in the colo's region over HTTP/2 and HTTP/3, including a hit from a second colo. This is a deploy under ADR 0151 (standing approval within $30 a month).
- Owed: `tofu apply` of the `http3 = "on"` zone setting added to `infra/tofu/global/zone.tf`.
- Closed for originals by TILES-009 (a rewritten original never comes from a stale edge cache), which signs the original's ETag into the token and the cache key. Other files can still be served stale for up to 10 minutes.
