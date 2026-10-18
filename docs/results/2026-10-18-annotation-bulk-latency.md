# Result: bulk annotation insert and listing on local Postgres

- Date: 2026-10-18
- Backlog: ANN-020 (annotation persistence API)
- Kind: baseline
- Commit: the ANN-020 commit on top of `3df749b`
- Environment: Apple M4, macOS 15.8.1, Python 3.14, Postgres 17 with PostGIS 3.6.1 and PgBouncer 1.26 in Docker (`compose.yaml`), the API in process through the FastAPI test client
- Data: 10,000 cells, each a 16-point circle of radius 6 px, on one slide with one class

## Question

How long does one request take to accept 10,000 shapes, and to list them again? The API latency budgets are still TODO in [ADR 0003](../adr/0003-pilot-platform-architecture.md), so this sets the provisional bound that the ANN-020 test enforces.

## Method

`test_ten_thousand_shapes_are_accepted_in_one_request_within_budget` in `apps/api/tests/test_annotations.py` posts the 10,000 drafts to `createAnnotations` and times the call with `time.perf_counter`. A temporary print timed `listAnnotations` on the same slide right after. Run three times with `uv run pytest -m db apps/api/tests/test_annotations.py -k ten_thousand -s`.

## Results

| Run | Bulk create (s) | List all (s) | List body (bytes) |
|---|---:|---:|---:|
| 1 | 1.240 | 0.199 | 8,390,289 |
| 2 | 1.273 | 0.194 | 8,390,289 |
| 3 | 1.268 | 0.201 | 8,390,289 |

## Interpretation

- The test bound is 5 s, four times the local number, so a slower CI runner does not flake. Assumption: the real budget from STACK-019 (Modal and Neon) will be looser for bulk writes, because they are rare and show progress.
- Listing a whole slide's 10,000 shapes as GeoJSON is 8.4 MB. The viewer should use the `bbox` filter, and a slide with more shapes than that belongs in result chunks ([ADR 0076](../adr/0076-annotation-and-ai-result-storage.md)).
- TODO: rerun against Neon from Modal when STACK-019 and STACK-020 are unblocked.
