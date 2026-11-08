# Result: a bulk insert of 10,000 annotations takes 1.37 s on an Apple M4 and 6.49 s on a busy hosted runner, with no slowdown from the text column

- Date: 2026-11-08
- Backlog: TEST-006 (performance budget suite), after ANN-036 (saved arrows, text and rulers) was suspected
- Kind: baseline
- Commit: dd303a79 on main
- Environment: GitHub hosted ubuntu runner with a PostGIS 17 service container for the CI rows. Apple M4, 24 GB, macOS 15, local PostGIS 17 in Docker for the local rows, with two other agents on the machine
- Data: 10,000 synthetic cell circles made by the test, no PHI

## Question

CI run 42507695084 failed `test_ten_thousand_shapes_are_accepted_in_one_request_within_budget` at 6.49 s against a 5 s limit. Did ANN-036, which added the `text` column of migration 0099 to the bulk insert, slow the request, or was the shared runner slow?

## Method

The CI numbers come from `gh run view RUN --log`, the `--durations=25` list and the assertion message. Locally the test ran three times with `uv run pytest -m "" apps/api/tests/test_annotations.py::test_ten_thousand_shapes_are_accepted_in_one_request_within_budget`, once at main and once with the `text` column removed from `INSERT_ANNOTATIONS` and `RECORD_VERSIONS`, then with the request time printed.

## Results

| Where | Run | Test call | Request alone | Whole db job |
|---|---|---|---|---|
| Hosted runner | 42293737714, before ANN-036 | 2.99 s | not printed | not read |
| Hosted runner | 42486119058, last green main before ANN-036 | 3.61 s | not printed | 1136 s |
| Hosted runner | 42507695084, after ANN-036 | 6.94 s | 6.49 s | 1630 s |

| Local Apple M4 | Test call, three runs |
|---|---|
| main with the text column | 1.91 s, 1.92 s, 1.87 s |
| text column removed from the insert | 1.90 s, 1.90 s, 1.90 s |
| request alone, main | 1.37 s, 1.38 s, 1.38 s |

## Interpretation

The text column costs nothing measurable, and nothing else in the bulk path changed between the green and the red run. The red run's whole db job took 1.43 times as long with about 100 more tests, and its other slow tests were 10 to 40 percent slower, so the runner was busy. The fixed 5 s limit was below what a busy runner needs.

## Follow-ups

The limit moved into `perf-budgets.json` as `api.bulk-10k-annotations-ms`, baseline 3610 ms, headroom 2.5, limit 9000 ms, under ADR 0154 (one budget file, time budgets declare headroom). TODO: print the request time on a few green hosted runs and tighten the baseline to it.
