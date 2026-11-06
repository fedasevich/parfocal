# Result: client chunk paging of 1.6 million nuclei

- Date: 2026-11-06
- Backlog: AINUC-005 (chunk paging in the client)
- Kind: benchmark
- Commit: d415ff1e plus the AINUC-005 change
- Environment: Apple M4 Mac, macOS, Node 26.13.0, Playwright with Google Chrome 156 headless and SwiftShader, 1280 x 720. A Node HTTP server on loopback sends the files with `Content-Encoding: gzip`, so Chrome inflates them. No latency proxy, no bandwidth limit
- Data: synthetic, no PHI. 1,607,244 cells (the CAMELYON synthetic count) on a 30 px grid with each centre moved by up to 8 px, 19 vertices per outline, 5 classes with random scores and type probabilities, in 361 chunks of a 2048 px grid, written in the PFC1 layout of ADR 0126 by `packages/viewer-engine/test/nuclei/synthetic.ts`. Random values compress badly, so the file sizes below are an upper bound for real cells (assumption)

## Question

Is the 1.6 million nucleus scenario of POC doc 31 usable in under 4 s at under 100 MB when the client keeps the summary and pages full chunks (AINUC-005)? The POC numbers were usable after 3.3 s, 86 MB of heap at fit and 191 MB in detail.

## Method

`packages/viewer-engine/browser/nuclei-paging.spec.ts` serves the files and opens `nuclei-paging.html` in a fresh browser context three times. The page calls `PagedCells.open` (fetch, inflate and parse the summary), then `show` on a 5760 x 3840 px view at the middle of the slide (the POC's z060 view, plus a quarter of margin), and the time between the two ends is "usable". It then removes cell C800000, sweeps 41 views spread over the slide, and looks the cell up again. After the sweep the spec forces garbage collection and reads memory with `performance.measureUserAgentSpecificMemory()` (which counts typed arrays), the JS heap from the Chrome DevTools protocol, and the bytes the library reports holding. The vertex budget is the default 4,000,000.

## Results

| Run | Usable (ms) | Summary open (ms) | Sweep median / p95 per view (ms) | Memory after sweep (MiB) |
|---|---:|---:|---:|---:|
| 1 | 112 | 73 | 37 / 44 | 75.4 |
| 2 | 110 | 71 | 37 / 44 | 75.3 |
| 3 | 148 | 96 | 37 / 46 | 75.3 |

The largest memory reading across the runs was 79,010,301 bytes, which is 75.4 MiB. The spec's limit is 100 MiB. Other sizes below are in decimal megabytes.

| What | Value |
|---|---:|
| Summary sent (gzip) | 23.4 MB (23,434,481 bytes) |
| Summary in memory | 41.8 MB |
| Cells resident after the first view | 93,093 in 20 chunks (1,768,767 vertices, 15.6 MB) |
| Resident after the sweep | 209,702 cells in 45 chunks (3,984,338 vertices, 35.2 MB) |
| Most resident vertices at any view | 3,988,309 of 4,000,000 |
| JS heap after garbage collection | 1.9 MB |
| Chunk requests for the open and the sweep | 812, 389 MB sent |
| One cell lookup, chunk not resident | 2.7 ms |
| Longest task seen by the page | 0 ms (none over 50 ms) |
| Deleted cell still deleted after eviction | yes |

A repeat run a few minutes later, while four other agents used the same machine, measured usable times of 215, 226 and 243 ms, sweep p95 of 84 to 117 ms and the same 75.3 to 75.4 MiB. The table above is the quiet run and sets the baseline.

## Interpretation

- The scenario is usable in 110 ms on this machine, about 30 times under the 4 s target and 30 times under the POC's 3.3 s. It is a loopback with no bandwidth limit, so it measures the client's CPU work and not a network. On a link the summary's 23.4 MB dominates, as the [paging spike](2026-10-18-cell-chunk-paging-spike.md) found at 50 Mbit/s (assumption: the same holds for this data).
- Memory stays at 75.3 to 75.4 MiB (79.0 MB) after a full sweep, 75 percent of the 100 MiB target. Of that, the summary is 41.8 MB and the resident chunks are 35.2 MB at the budget. Nearly all of it is typed arrays, which is why the JS heap alone is 1.9 MB and is not the right number to budget.
- The 4,000,000 vertex budget holds: the most resident at any view was 3,988,309.
- Not measured: peak memory while the summary downloads and inflates (compressed and inflated copies can exist together), the explicit `DecompressionStream` path at this size (only unit tests cover it), drawing, and real cells instead of random ones.

## Follow-ups

- [ADR 0242](../adr/0242-client-chunk-paging-for-large-nuclei-sets.md) (the client keeps the summary whole and pages full chunks under a vertex budget) records the design.
- Two rows in `perf-budgets.json` (`nuclei.paging-open-ms` and `nuclei.paging-memory-bytes`) guard these numbers.
- The first hosted CI run measured the open time at 340 ms, three times the Mac, so `nuclei.paging-open-ms` has baseline 340 ms and limit 1000 ms. The spec still asserts the 4 s target.
- TODO: record more hosted-runner numbers and tighten the time headroom.
- TODO: measure a real HoVer-NeXt result once one is imported.
