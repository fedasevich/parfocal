# Result: paging 1.6 million cells from binary chunks in the browser

- Date: 2026-10-18
- Backlog: STACK-021 (annotation and AI result storage model)
- Kind: spike
- Commit: `107e6b9` (no repository code was measured, the spike scripts ran outside the repository)
- Environment: Apple M4, macOS 15.8.1, Node 26.9.0, Playwright 1.64.0 with Chrome Headless Shell 156.0.8078.4, Python 3.14 with numpy 2.5.4. Served from 127.0.0.1 by a small Python HTTP/1.1 server, unshaped and shaped to 100 ms per request and 50 Mbit/s
- Data: the POC's synthetic whole-slide job `synth0001503` (Huron-1-40x nucleus outlines tiled over the tissue of CAMELYON16 `tumor_009`, 1,607,244 cells in 1,503 chunks of 1920 px), read from the POC fixtures without changing them. Type probabilities were made up per cell (5 classes, peaked at the stored class), because the POC format had dropped them

## Question

Can the chunk format proposed in [ADR 0076](../adr/0076-annotation-and-ai-result-storage.md) page 1.6 million cells in the browser within the POC doc 31 numbers? Those were usable 3.3 s after opening the job (Viv, local), a heap of 86 MB at fit and 191 MB in detail, and outlines on screen within about a second of a camera move.

## Method

1. A converter read every POC chunk (`.npz`) and wrote the ADR 0076 container (`PFC1`, a JSON header and 8-byte aligned little-endian arrays), gzip level 6. Each chunk holds the cell number, ring offsets, float32 ring points at level 0, class, score, 5 type probabilities, flags and parent region. The summary holds one row per cell in number order (x, y, diagonal, class, score, flags, chunk, index in chunk). Cells were numbered in reading order of their centroids, as ADR 0071 says.
2. A Python server sent the files with `Content-Encoding: gzip`, so the browser inflates them natively, and with `Cache-Control: no-store`. The shaped run slept 100 ms before each response and paced the body to 50 Mbit/s.
3. A page started a module worker. The worker fetched and parsed the summary into typed array views, then paged views of 5760 × 3840 level-0 pixels (about z060 in the POC) plus a quarter on each side, nearest chunk first, 8 requests at a time, with least-recently-used eviction above 4,000,000 vertices (the POC budget).
4. Playwright opened the page, timed the summary, paged one view at the middle chunk, then 41 views spread over the slide (every 37th chunk), then looked up cell C800000 and its probabilities. Held memory is the page's JS heap plus the bytes of the worker's summary and resident chunk buffers. Each configuration ran three times.

## Results

File sizes:

| What | Raw | gzip |
|---|---:|---:|
| Summary, 1,607,244 rows | 27.36 MB | 14.07 MB |
| 1,503 chunks, 30,340,293 vertices | 275.8 MB | 125.3 MB |

Browser, median of three runs (the three runs were within 2% of each other):

| Network | Summary ready | Held at fit | One detail view (15 chunks, 17,223 cells) | Held after detail | Sweep median / p90 / max per view (41 views) | Most resident vertices | Held after sweep | One cell lookup |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| local | 77 ms | 29 MB | 12 ms | 32 MB | 8 / 10 / 10 ms | 3,999,876 | 65 MB | 1 ms |
| 100 ms, 50 Mbit/s | 3,277 ms | 29 MB | 492 ms | 32 MB | 376 / 494 / 508 ms | 3,999,876 | 65 MB | 126 ms |

POC doc 31 for comparison (Viv, local, production build): usable after 3.3 s, 86 MB heap at fit, 191 MB at z060, outlines within about a second.

## Interpretation

- On a local server the data path is about 40 times under the POC's 3.3 s, and on a shaped link it matches it. The summary download dominates the shaped number: 14 MB at 50 Mbit/s is 2.25 s of transfer alone.
- Memory stays at a third of the POC's because cells live in typed arrays and never become JS objects. The eviction budget holds at 4,000,000 vertices.
- A detail view is under 0.5 s on the shaped link, inside the POC's "about a second".
- Not measured: drawing. The POC's GPU times belong to the renderer and are measured in the VIEW epic with this format as input. Assumption: HTTP/2 from R2 behind a CDN will do no worse than the 6 connections of HTTP/1.1 here.
- The summary is the one cost that grows with the slide. TODO: if pilot links are slower than 50 Mbit/s, split the summary by region of the slide or quantise x and y to 16 bits per chunk (about 40% smaller).
