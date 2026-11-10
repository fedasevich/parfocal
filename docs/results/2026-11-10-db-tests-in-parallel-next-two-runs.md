# Result: the next two ci runs of the database tests on four workers

- Date: 2026-11-10
- Backlog: TEST-027 (database tests in parallel)
- Kind: baseline
- Commit: 14440004 (measured on ci in the pushes 374e054a and 979b041f)
- Environment: GitHub hosted `ubuntu-latest` runner.
- Data: the database test selection `pytest -m db`, with the `small` fixtures required on ci.

## Question

The [first result](2026-11-10-db-tests-in-parallel.md) had one ci run at 14 min 36 s and asked for two more. Does the `db` job stay near 15 minutes?

## Method

The whole job time is the start and end of the `db` job of each ci run on main. The pytest time and the counts are the pytest summary line in the job log. The ci command did not change: `uv run pytest -m db -n 4 --dist loadfile --durations=25`.

## Results

| ci run | Commit | Whole job | pytest | Passed | Skipped |
|---|---|---|---|---|---|
| 42752867296 | 10826ecd | 14 min 36 s | 12 min 53 s | 2,944 | 212 |
| 42756786906 | 374e054a | 17 min 23 s | 15 min 51 s | 2,944 | 212 |
| 42760161686 | 979b041f | 18 min 24 s | 17 min 1 s | 2,944 | 212 |

The `browser (ui)` job of the second and the third run, for scale: 36 min 29 s and 35 min 39 s.

## Interpretation

The first run was the fastest of the three. The job takes 15 to 18 minutes on a hosted runner, with the same tests and the same counts each time, so the spread comes from the runner and not from the tests. That is still about half of the 27 to 37 minutes before, still not under the 10 minutes the task asks for, and still shorter than `browser (ui)`, which ends the ci run.

## Follow-ups

- Decision 86 in [decisions.md](../decisions.md) now names 15 to 18 minutes instead of about 15.
- TEST-027 stays in review until the owner answers decision 86.
