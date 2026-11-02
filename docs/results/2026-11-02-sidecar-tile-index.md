# Result: opening a BigTIFF with and without the sidecar tile index at 100 and 200 ms RTT

- Date: 2026-11-02
- Backlog: INGEST-007 (sidecar tile index)
- Kind: comparison
- Commit: 2758c22 plus the uncommitted INGEST-007 reader changes in `packages/viewer-engine`
- Environment: Apple M4, macOS, Node 26.13.0, geotiff 3.0.5. Origin and `@parfocal/latency-proxy` on 127.0.0.1, unlimited bandwidth, `fetch` limited to 6 requests in flight like a browser on HTTP/1.1. Another agent was running on the machine.
- Data: a generated little-endian BigTIFF of 11 deflate levels from 65536 px square down to 64 px, 256 px tiles, every directory in its own 1 MiB block (25 MB on disk), and the cached public slides below for sidecar sizes. No PHI.

## Question

Does the sidecar bring the open of a BigTIFF with eleven directories below 1 s at 100 ms RTT, against the POC's 4.2 s walk at about 200 ms RTT?

## Method

1. `node --test test/pixel-source/tile-index.test.ts` in `packages/viewer-engine` writes the BigTIFF and its sidecar, serves both through the latency proxy and times two opens in one run: `openTiffSource` without an index, then fetching `tile-index.json`, `readTileIndex` and `openTiffSource` with it. Both times include reading the coarsest tile.
2. The same test with `rttMs` set to 200, run once by hand.
3. `tile_index` from `parfocal_ingest.tile_index` on each cached slide, timing the call and measuring the JSON before and after gzip.

## Results

| RTT | Walk the chain | With the sidecar |
|---|---|---|
| 100 ms | 1329, 1389, 1386 ms | 354, 383, 392 ms |
| 200 ms | 2625 ms | 692 ms |

| Slide | Levels | Tiles | JSON bytes | Gzipped bytes | Slide bytes | Write time |
|---|---|---|---|---|---|---|
| `CMU-1.svs` | 3 | 24813 | 305887 | 123344 | 177552579 | 4 ms |
| `CMU-1.ndpi` | 4 | 156451 | 969592 | 231037 | 198030965 | 19 ms |
| `OS-1.bif` | 10 | 11664 | 179061 | 77979 | 3871468922 | 60 ms |
| `tumor_009.tif` | 10 | 108136 | 1494917 | 525313 | 2466318858 | 17 ms |
| `Philips-4.tiff` | 9 | 31710 | 208565 | 50141 | 290991342 | 4 ms |
| `Leica-1.scn` | 5 | 5844 | 48002 | 16804 | 291812870 | 1 ms |
| `Huron-1-40x.tif` | 3 | 4254 | 39325 | 13495 | 115718398 | 1 ms |

## Interpretation

The walk costs one round trip per directory plus the header and the tile, about 13 RTTs. With the sidecar the open costs the sidecar, the header, two waves of directory reads (11 reads over 6 connections) and the tile, about 4 RTTs, and stays below 1 s at 100 ms. At 200 ms the walk takes 2.6 s here against the POC's 4.2 s in Chrome against S3, which also paid TLS and S3 latency. The sidecar download is not bandwidth limited in this test. The largest one, `tumor_009.tif` at 0.53 MB gzipped, adds about 85 ms on a 50 Mbit/s link.

## Limits

Node, not a browser, and a generated file, not a real cross-region bucket. geotiff runs the same directory code in Node and the browser (ADR 0099), and the proxy's connection model is in its README. TODO: repeat in Chrome against a staging bucket once VIEW-049 serves the sidecar.
