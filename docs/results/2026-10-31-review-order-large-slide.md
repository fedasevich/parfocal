# Result: least sure first order on a large synthetic slide

- Date: 2026-10-31
- Backlog: GUIDE-012 (least sure first order)
- Kind: benchmark
- Commit: b83bd0e
- Environment: MacBook Air, Apple M4, 24 GB memory, macOS (Darwin 24.6.0), CPython 3.14.7, one process, no database
- Data: synthetic `PFC1` chunks made by the test, 2,000 cells per chunk, four-vertex rings, four classes with `probs`, gzip level 9 (no PHI)

## Question

How long does computing and packing a task slide's order take on a slide of 1.6 million cells, the POC doc 31 (paging 1.6 million nuclei) scenario, and how big is the stored order? [ADR 0117](../adr/0117-review-order-is-stored-per-task-slide.md) (review order stored per task slide) computes the order inside task creation, and this run checks that this is acceptable until GUIDE-013 (review order as a background job) moves it into a job. There is no budget for this step yet.

## Method

`test_a_large_slide_orders_within_a_sane_time_and_size` in `packages/py-common/tests/test_review_order_cells.py` builds the chunks in memory, then times two paths with `time.perf_counter`:

1. Random cells, 200: decode every chunk, add it to a `CellPool`, sample 200, order and pack.
2. Cells below a score of 26 (0.1 of 255): decode every chunk, filter each with `in_scope`, order and pack.

The timed part covers gunzip, decode, scope, certainty, ordering and packing. It leaves out reading files from disk, the database and the HTTP request. Run three times with:

```sh
REVIEW_ORDER_CELLS=1600000 uv run pytest packages/py-common/tests/test_review_order_cells.py -q -s -k large -p no:cacheprovider
```

CI runs the same test at the default 200,000 cells, with a bound of 0.1 ms per cell for each path.

## Results

1,600,000 cells in 800 chunks, 15,249,419 bytes of gzipped chunks in memory.

| Run | Random 200 s | Random 200 bytes | Below a score s | Below a score cells | Below a score bytes |
|---|---|---|---|---|---|
| 1 | 0.797 | 1,000 | 2.728 | 162,500 | 812,500 |
| 2 | 0.405 | 1,000 | 1.309 | 162,500 | 812,500 |
| 3 | 0.360 | 1,000 | 1.329 | 162,500 | 812,500 |

An earlier run on the uncommitted working tree, with the same code, gave 0.340 s and 1.103 s.

## Interpretation

- The stored order is five bytes per object, so a random sample of 200 stays at 1 kB however big the slide is, and 162,500 cells below a score take 0.8 MB in one `bytea`.
- Random 200 presumably spends its time decoding every chunk and pooling 1.6 million numbers, which is why it takes almost half a second even though it keeps only 200 cells.
- Cells below a score build one `Candidate` per cell, chunk by chunk, and take 1.3 to 2.7 seconds here. The first run was the slowest of the three, which is assumed to be a cold start and was not investigated.
- Assumption: reading the files from disk or object storage and the PostGIS containment of the inside scopes add to this, and a Modal container is slower than an M4 laptop. A task over many large slides would multiply the time by the slide count, which is the case for GUIDE-013 (review order as a background job).

## Follow-ups

- GUIDE-013 (review order as a background job) moves the computation out of the request for real slides.
- TODO: time the whole request with files on disk and in object storage once STACK-025 (object storage, CDN and signed access) and AIP-013 (result chunk store) put real chunk files there.
