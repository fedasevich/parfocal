# Result: Cell summary size for 1.6 million cells

- Date: 2026-11-02
- Backlog: AINUC-004 (summary points API)
- Kind: baseline
- Commit: 36f114d plus the AINUC-004 change
- Environment: MacBook Air M4, macOS, Python 3.14, numpy, the ingest worker's columnar writer
- Data: synthetic, no PHI. 1,607,244 square cells on a 30 px grid with each centre moved by up to 8 px at random, a random size of 4 to 9 px, random classes and scores, and random type probabilities from a flat Dirichlet, seed 7

## Question

Does the gzip summary file that `GET /api/result-sets/{id}/cell-summary` serves stay under the 25 MB budget of AINUC-004 for the 1.6 million cells of the CAMELYON synthetic file?

## Method

`jittered_table` in `apps/api/tests/test_cell_summary.py` builds the cells, `parfocal_ingest.chunk_builder.plan_chunks` and `build_table` write the chunks and the summary with its chunk index, and the size is the length of the gzip summary file, which is what the route sends. The test of the same name stores it in MinIO and checks the route's `Content-Length`.

## Results

| Classes | Probabilities | Chunks | Summary bytes sent | Build seconds |
|---|---|---|---|---|
| 9 | yes | 399 | 27,161,961 | 3.7 |
| 9 | no | 399 | 15,640,807 | 3.0 |
| 5 | yes | 399 | 22,636,641 | 3.3 |
| 5 | no | 399 | 15,454,315 | 2.9 |
| 2 | yes | 399 | 17,943,046 | 3.1 |
| 2 | no | 399 | 15,167,065 | 3.0 |

## Interpretation

Up to five classes every case fits 25 MB, and five classes with probabilities uses 91 % of it. Nine classes, the most a project allows, send 27.2 MB with probabilities, 9 % over, and 15.6 MB without. The 25 MB is a loading target of AINUC-004, not a limit: the route serves a summary of any size, and the owner asked on 2026-11-02 for no hard limit. Random jitter, scores and probabilities compress worse than real cells, whose neighbours share classes and scores, so a real set is likely smaller. That is an assumption, not measured. The test checks the target at five classes.

## Follow-ups

- TODO: measure a real HoVer-NeXt result of a CAMELYON slide once one is imported.
- AINUC-005 (chunk paging in the client) reads this file first.
