# Result: one parse sandbox per job carries a 1.1 GB slide once

- Date: 2026-11-18
- Backlog: SEC-051 (carry a slide into the parse sandbox once per job)
- Kind: measurement
- Commit: the SEC-051 commit that keeps one sandbox per ingest job in `workers/deploy/src/parfocal_deploy/parse_sandbox.py`
- Environment: Modal environment `dev`, app `parfocal-parse-slide-probe`, run 1 `ap-sQpCTcI3IpXo4ftbMeSiLD`, run 2 `ap-rDYjBGB4w7evMhKcxWIXo8`. Function memory 4096 MiB, sandbox options `PARSE_SANDBOX_OPTIONS` (network blocked, `(3072, 3072)` MiB, a 5400 s lifetime, a 300 s idle timeout).
- Data: `test_001.tif` from CAMELYON16 (CC0), 1,142,160,268 bytes, Philips TIFF, 9 levels. No PHI.

## Question

The [last measurement](2026-11-18-parse-sandbox-real-slide.md) found that copying the slide into five separate sandboxes took 81 and 90 percent of the sandboxed parse time. With one sandbox kept for the job's five parse steps, is the slide copied once, and how close does the sandboxed time come to the local child?

## Method

Same as the last measurement. `modal volume put -e dev` of the slide to a probe Volume, then `uv run --package parfocal-deploy modal run -e dev -m parfocal_deploy.parse_slide_probe` twice. The probe now parses with `keep=True` as the ingest workflow does, counts the sandboxes it creates and every `copy_from_local`, and releases the sandbox after derive. The Volume was deleted after run 2 and `modal volume list -e dev` no longer shows it.

## Results

Both runs passed every step in both launchers: `philips-tiff`, 9 levels at validate and index, no refusal, and no sandbox of the app left at the end.

Each run created one sandbox and made one copy of the slide.

| | Run 1 | Run 2 |
|---|---|---|
| Sandboxes created | 1 | 1 |
| Slide copies | 1 | 1 |
| Copy seconds | 6.52 | 6.86 |

Seconds per step, each step all in. Identify includes the sandbox start and the copy.

| Step | Sandbox run 1 | Sandbox run 2 | Local child run 1 | Local child run 2 |
|---|---|---|---|---|
| identify | 9.57 | 12.70 | 2.95 | 2.67 |
| scan | 2.29 | 2.11 | 2.20 | 1.83 |
| validate | 2.23 | 2.26 | 2.18 | 1.84 |
| index | 2.72 | 2.17 | 2.29 | 1.89 |
| derive | 3.19 | 2.66 | 2.60 | 2.26 |
| total | 19.99 | 21.89 | 12.23 | 10.49 |

The stand-in fetch from the Volume to `/tmp` took 1.03 s in run 1 and 0.90 s in run 2.

Cost: TODO, Modal's billing report did not show these runs yet.

## Interpretation

- The slide is carried once per job. The sandboxed parse of the five steps fell from 77 and 154 s to 20 and 22 s, about 8 to 11 s over the local child.
- After identify, each step in the kept sandbox costs about the same as in a local child, so starting an `exec` in a running sandbox adds little.
- The one copy took 6.5 and 6.9 s here against 7.0 to 59.2 s per copy before. Two runs do not show whether the eightfold spread is gone, so a 3 GiB slide could still take a minute for its one copy.
