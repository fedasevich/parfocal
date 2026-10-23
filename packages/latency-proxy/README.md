# Latency proxy

An HTTP/1.1 proxy that adds a round-trip time to every request and limits download bandwidth, for TILES-006 (latency proxy test harness). Perf suites such as TEST-006 (performance budget suite) and TILES-005 (range coalescing) put it between the browser and the server they measure. It follows the POC's `scripts/latency-proxy.mjs` and adds bandwidth, a typed API and tests.

## How it models the network

| Setting | Effect |
|---|---|
| `rttMs` | Every proxied request waits this long before it is forwarded, so each request costs one RTT on top of the server's own time |
| `bandwidthBytesPerSecond` | Response bodies leave the proxy in 16 KiB slices paced to this rate. All responses share one link, so two parallel downloads each get half. `null` means unlimited |

Request bodies are not throttled. Connection setup costs no extra RTT, and the browser opens at most six HTTP/1.1 connections to the proxy, so a seventh parallel request waits for a free connection. Production is served over HTTP/2 or HTTP/3, which multiplex, so request counts weigh more here than in the field. TODO: add an HTTP/2 mode if a perf budget depends on more than six requests in flight.

## Using it in a test

```ts
import { startLatencyProxy, RTT_MATRIX_MS } from "@parfocal/latency-proxy";

const proxy = await startLatencyProxy({ target: "http://localhost:5173", rttMs: 100 });
await page.goto(`${proxy.url}/viewer`);
proxy.setConditions({ rttMs: 200, bandwidthBytesPerSecond: 5_000_000 });
proxy.stats();
await proxy.close();
```

`perf/network.ts` is a Playwright fixture with `rttMs` and `bandwidthBytesPerSecond` options, and `playwright.config.ts` makes one project per RTT in `RTT_MATRIX_MS` (0, 50, 100 and 200 ms). A perf spec that imports `test` from `perf/network.ts` runs once per RTT. `perf/request-latency.spec.ts` is the example.

A page can change the conditions itself through `GET /__latency?rtt=50&bandwidth=1000000`, and `&reset` zeroes the request and byte counters. `bandwidth=unlimited` removes the limit.

## Commands

```
pnpm --filter @parfocal/latency-proxy test           # proxy tests at 0, 50, 100 and 200 ms RTT, no browser
pnpm --filter @parfocal/latency-proxy test:browser   # the Playwright perf example, one project per RTT
pnpm --filter @parfocal/latency-proxy measure        # prints the added-latency and bandwidth tables
TARGET=http://localhost:5173 RTT_MS=100 pnpm latency-proxy   # a standalone proxy on port 5399
```

The tests pass when the fastest proxied request takes at least the set RTT and no more than `max(10 ms, 10%)` above it, compared with the fastest direct request. Medians are reported but not asserted, because a loaded CI runner only ever adds time. Measured numbers are in the [result file](../../docs/results/2026-10-23-latency-proxy.md).
