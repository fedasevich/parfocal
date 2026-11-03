# Result: signed slide bytes on the app origin open without a preflight in Chrome, and another origin doubles the open

- Date: 2026-11-03
- Backlog: TILES-003 (same-origin data path)
- Kind: comparison
- Commit: measured from the working tree on top of ec77538
- Environment: Apple M4, macOS, Node 26.13.0, Playwright 1.64.0 driving headless Chrome with SwiftShader. Two `@parfocal/latency-proxy` instances on 127.0.0.1, unlimited bandwidth, HTTP/1.1, so Chrome keeps at most six connections per origin. Behind each proxy a Node server runs the edge Worker's own `handleTiles` from `apps/edge/src/tiles.ts` over a folder standing in for R2. Other agents were running on the machine.
- Data: the generated 11-level spread BigTIFF of INGEST-007 (sidecar tile index), 65536 px square, 256 px deflate tiles, each directory in its own 1 MiB block, and its `tile-index.json`. No PHI.

## Question

Does reading slide bytes from the app origin remove every CORS preflight when the viewer sends its capability token in `Authorization`, and does the open in a browser stay within the 1 s budget INGEST-007 set at 100 ms RTT?

## Method

1. `pnpm --filter @parfocal/viewer-engine exec playwright test browser/same-origin.spec.ts`. The page loads from proxy A. In the same-origin arm the bytes come from proxy A under `/tiles/{slide}/`. In the cross-origin arm they come from proxy B, whose server answers preflights with `Access-Control-Allow-Origin` for the page, `Allow-Headers: authorization, range` and `Max-Age: 7200`.
2. Each open uses a fresh slide id and token, so no URL repeats between opens. Each arm does one walk of the directory chain and then three opens with the sidecar. An open is timed from the first byte request to the decoded coarsest tile, as in INGEST-007. Every request goes through `TileAccess.fetch`, so it carries `Authorization: Bearer`.
3. The servers count `OPTIONS` requests and byte reads themselves, because Playwright answers preflights on its own when routing is on.
4. The same spec with `SAME_ORIGIN_RTT_MS=200`, run once by hand.
5. Before `TileAccess` asked for `cache: "no-store"`, the same-origin arm ran once with the browser's default cache mode.
6. `node --test test/pixel-source/tile-index.test.ts` in `packages/viewer-engine` on the same machine on the same day, for the Node number INGEST-007 reported.

## Results

Times in milliseconds. Preflights and reads are for the whole arm of four opens.

| RTT | Arm | Walk | Sidecar, three opens | Preflights | Byte reads |
|---|---|---|---|---|---|
| 100 ms | same origin | 1675, 1674 | 637, 632, 635 and 630, 626, 638 | 0, 0 | 63, 63 |
| 100 ms | other origin | 3256, 3246 | 1265, 1281, 1283 and 1255, 1278, 1290 | 63, 63 | 63, 63 |
| 200 ms | same origin | 3281 | 1253, 1248, 1237 | 0 | 63 |
| 200 ms | other origin | 6341 | 2469, 2457, 2455 | 63 | 63 |
| 100 ms | same origin, default cache mode | 1773 | 1354, 1371, 1367 | 0 | 55 |

| RTT | INGEST-007 in Node | Node today | Chrome today, same origin |
|---|---|---|---|
| 100 ms | walk 1329 to 1389, sidecar 354 to 392 | walk 1396, sidecar 376 | walk 1674 to 1675, sidecar 626 to 638 |
| 200 ms | walk 2625, sidecar 692 | | walk 3281, sidecar 1237 to 1253 |

## Interpretation

- On the app origin no preflight was sent in any run, although every request carried `Authorization`. On another origin every one of the 63 reads was preflighted, despite `Access-Control-Max-Age: 7200`. The likely cause is that Chrome skips its preflight cache for a request that bypasses the HTTP cache. The other-origin arm was not run with the default cache mode, so this is not checked. The extra round trip per read doubles the open, 1.26 to 1.29 s against 0.63 s at 100 ms RTT, and the walk, 3.25 s against 1.67 s. POC doc 09 (four research claims, retested) found no preflight in the POC, because a bare `Range` header is CORS-safelisted. The token header is not, so for this platform the preflight is real and the same-origin path removes it.
- The sidecar open in Chrome stays under the 1 s budget at 100 ms RTT, so the INGEST-007 budget holds in a browser. It costs about six round trips against about four in Node. The server log of one open shows the sidecar, the header, two waves of six and five directory reads, a second read inside the coarsest directory and the tile. Node reads through geotiff's 1 MiB block cache, which keeps the second read in memory, while the signed path injects `TileAccess.fetch` and reads exact ranges with no block cache, as decode workers need for tiles.
- With the browser's default cache mode the same-origin sidecar open took 1.35 to 1.37 s. Chrome lets one request at a time write a URL's cache entry, so parallel ranges of one file queue behind each other. `TileAccess` now asks for `cache: "no-store"` unless the caller sets a cache mode, which brought the open to 0.63 s. The viewer keeps bytes in its own range cache, so the HTTP cache added nothing.

## Limits

Node's HTTP server and a folder stand in for the Worker runtime and R2, the network is a loopback proxy on HTTP/1.1, and the file is generated. Production serves HTTP/2 or HTTP/3, which multiplexes, so the waves of six would shrink, but the preflight count and the round trips per open do not depend on the protocol. TODO: repeat against the staging Worker and bucket from a browser in another region once the staging deploy carries this change.
