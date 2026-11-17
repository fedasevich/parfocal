# Result: a real 1.1 GB slide through the five parse steps in the Modal sandbox

- Date: 2026-11-18
- Backlog: SEC-045 (isolate the remaining parse steps and run them in a Modal sandbox)
- Kind: measurement
- Commit: the SEC-045 commit that adds `workers/deploy/src/parfocal_deploy/parse_slide_probe.py`
- Environment: Modal environment `dev`, app `parfocal-parse-slide-probe`, run 1 `ap-39UnAvkpG4f4LgfOFreaR9`, run 2 `ap-pzxAp6CLBHxeE4Mx0pgpAC`. Function memory 4096 MiB, sandbox options `PARSE_SANDBOX_OPTIONS` (network blocked, `(3072, 3072)` MiB, 1800 s).
- Data: `test_001.tif` from CAMELYON16 (CC0), 1,142,160,268 bytes, Philips TIFF, 9 levels. No PHI.

## Question

The [first probe](2026-11-16-parse-sandbox-on-modal.md) measured only an 87 KB fixture and a 100 MiB blob. Does a real 1 to 3 GiB slide pass the five ingest parse steps in the sandbox, and do the five copies of the file into five sandboxes dominate the time?

## Method

1. `modal volume put -e dev parfocal-parse-slide-probe test_001.tif` from the Mac to a dev Volume made for the probe.
2. `uv run --package parfocal-deploy modal run -e dev -m parfocal_deploy.parse_slide_probe`, twice. The function copies the slide from the Volume to `/tmp` as a stand-in for the R2 fetch, then runs identify, scan, validate, index and derive through `parse_isolated`, first with the sandbox launcher wrapped to time each `copy_from_local`, then with the default local child launcher in the same function as a baseline.
3. The Volume was deleted after run 2.

This covers the five parse steps only, not the database writes, the R2 reads and writes or the tile work of the whole ingest.

## Results

Both runs passed every step in both launchers: `philips-tiff`, 9 levels at validate and index, no refusal, no `parse-too-slow`, no `parse-too-large`, and no sandbox of the app left at the end.

Seconds per step, each step all in:

| Step | Sandbox run 1 | Copy in run 1 | Sandbox run 2 | Copy in run 2 | Local child run 1 | Local child run 2 |
|---|---|---|---|---|---|---|
| identify | 11.19 | 8.73 | 32.29 | 28.73 | 3.53 | 3.78 |
| scan | 11.94 | 9.53 | 11.46 | 9.41 | 2.55 | 2.51 |
| validate | 12.29 | 9.85 | 62.15 | 59.16 | 2.57 | 2.61 |
| index | 29.01 | 25.03 | 37.27 | 33.20 | 2.69 | 2.81 |
| derive | 12.46 | 9.46 | 10.37 | 7.00 | 3.28 | 3.45 |
| total | 76.89 | 62.60 | 153.53 | 137.51 | 14.62 | 15.15 |

The stand-in fetch from the Volume to `/tmp` took 2.32 s in run 1 and 1.07 s in run 2.

Cost: TODO, Modal's billing report did not show these runs yet.

## Interpretation

- A real 1.1 GB slide passes all five steps in the sandbox under the shipped limits. The slowest step took 62 s against the 1800 s deadline, so the copy counting against the deadline is not a risk at this size.
- The copies dominate. They were 81 percent of the sandboxed time in run 1 and 90 percent in run 2, and one 1.1 GB copy took 7.0 to 59.2 s, an eightfold spread like the first probe's. Without the copies the sandboxed steps took 14.3 and 16.0 s, close to the local child's 14.6 and 15.2 s.
- So the sandbox start and the parse itself cost little. Carrying the file five times costs 1 to 2.5 minutes per slide of this size, and a 3 GiB slide would cost about three times that.

## Follow-ups

- ADR 0325 (isolated parsing of uploaded files) has its sandbox TODO answered with these numbers.
- SEC-051 (carry a slide into the parse sandbox once per job) is added for one sandbox or one per-job Volume per job.
- TODO: the cost of both runs once the billing report shows them.
