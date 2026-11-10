# Result: the database tests on four workers

- Date: 2026-11-10
- Backlog: TEST-027 (database tests in parallel)
- Kind: baseline
- Commit: 14440004 (measured on ci as part of the push 10826ecd)
- Environment: GitHub hosted `ubuntu-latest` runner for ci. MacBook with 10 cores and 24 GB for the local runs, with another agent session working on the same machine.
- Data: the database test selection `pytest -m db`, with the `small` fixtures required on ci.

## Question

Does running the `db` job with pytest-xdist bring it under 10 minutes with the same tests passing, without a template database?

## Method

`pytest-xdist` 3.8.0 was added to the dev group and the ci command became `uv run pytest -m db -n 4 --dist loadfile --durations=25`. No test and no fixture changed. The session fixture `database` already makes and migrates one database per pytest session, and each xdist worker is its own session.

The times before are the `db` job of the last five ci runs on main and the pytest summary line of two of them. The time after is the `db` job of ci run 42752867296 on 10826ecd. The local runs used `uv run --with pytest-xdist pytest -m db` in `apps/api` and the ci command from the repository root.

## Results

The `db` job on ci, serial:

| ci run | Commit | Whole job | pytest | Passed | Skipped |
|---|---|---|---|---|---|
| 42729976827 | 1f61523d | 32 min 36 s | not read | not read | not read |
| 42736212024 | fc1723ce | 36 min 59 s | not read | not read | not read |
| 42738571169 | 63c72a69 | 37 min 6 s | not read | not read | not read |
| 42742973648 | cf700547 | 27 min 1 s | 25 min 2 s | 2,709 | 2 |
| 42745190774 | 388fad2b | 28 min 7 s | 26 min 5 s | 2,709 | 2 |

The `db` job on ci, four workers by file:

| ci run | Commit | Whole job | pytest | Passed | Skipped |
|---|---|---|---|---|---|
| 42752867296 | 10826ecd | 14 min 36 s | 12 min 53 s | 2,944 | 212 |

The same push added 235 passing tests and 210 skips to the selection: the write isolation suite of SEC-043 (every write route is sent as another workspace), the mixed probes of SEC-044 (a write on my own path that carries another workspace's id) and one test of PROJ-012 (removing a class that stored work uses). 2,709 plus 235 is 2,944 and 2 plus 210 is 212, so no earlier test was lost.

Local runs on the Mac, all passing:

| Command | Tests passed | Wall time | CPU time of pytest |
|---|---|---|---|
| `-n 3 --dist loadfile` in `apps/api` | 2,938 | 7 min 18 s | 903 s |
| `-n 3 --dist worksteal` in `apps/api` | 2,938 | 8 min 0 s | 990 s |
| `-n 4 --dist loadfile` from the root | 2,944 | 7 min 26 s | 1,191 s |

Other jobs of ci run 42745190774, for scale: `browser (ui)` 37 min 46 s, `browser (web 2/3)` 34 min 18 s, `browser (web 1/3)` 21 min 18 s, `browser (web 3/3)` 20 min 38 s, `browser (viewer-engine)` 14 min 39 s.

## Interpretation

The job is about half as long as before and is no longer the longest job, but one ci run is not under the 10 minutes the task asks for. The local runs are one run each on a shared machine and the four worker run used another directory and six more tests, so they do not compare worker counts. They show only that the suite passes in parallel in both distribution modes. Assumption, not measured: Postgres, the pooler and the workers share the runner's cores, so more workers on one runner would gain little, and under 10 minutes would take a second runner with half of the files. Nobody tried more than four workers on ci.

A ci run is as long as its longest job, which is `browser (ui)` at about 37 minutes, so a `db` job of 15 minutes or of 8 minutes ends the run at the same time.

## Follow-ups

- TEST-027 stays in review. Decision 86 in [decisions.md](../decisions.md) asks whether 15 minutes closes it.
- Two more ci runs are needed before anyone calls the time stable. TODO: read the `db` job of the next two runs on main.
