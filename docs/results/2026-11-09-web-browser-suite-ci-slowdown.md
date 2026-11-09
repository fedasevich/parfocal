# Result: the web browser suite slows by a steady per-runner factor on CI, so the job is split into three shards

- Date: 2026-11-09
- Backlog: TEST-021 (find why the web browser suite slowed on CI)
- Kind: baseline
- Commit: runs from `cc8d71a0` to `5d16c289` on `main`, measured before the shard change
- Environment: GitHub Actions `ubuntu-latest` public runner, image `ubuntu-26.04` version `20261101.186.1`, runner `2.338.2`, Google Chrome `156.0.8078.79`, Playwright with 2 workers against the Vite dev server. The image, image version, runner version and Chrome build were the same in every run below.
- Data: the `apps/web/e2e` Playwright suite on the fake API, no PHI

## Question

The `browser (web)` job of the `ci` workflow grew from about 32 to 67 minutes within a day. Is the cause the runner, a shared fixture or the fake API store leaking over the run, a dev server rebuild, or a few new heavy specs? The budget is a job under 45 minutes on three runs in a row.

## Method

Job and step times came from `gh run view RUN --json jobs`. Per-test times came from the Playwright list reporter in `gh run view --job JOB --log`, summed per spec file. A spec total includes retries of failed tests. Per-test ratios match the same test title in each run against the run of 2026-11-08 21:26, use only passed tests longer than 0.5 s, and are split into the first, middle and last third of the run by log order.

## Results

### Job and test step time

| Run | Started (UTC) | Commit | Tests run | Sum of test times (s) | Test step (min) | Median per-test ratio by third |
|---|---|---|---|---|---|---|
| 42512374109 | 2026-11-08 18:55 | `cc8d71a0` | 690 | 3724 | 31.4 | |
| 42525164272 | 2026-11-08 21:26 | `a791eb63` | 718 | 3812 | 32.2 | 1.00 (reference) |
| 42528015448 | 2026-11-08 22:00 | `c35eeab5` | 720 | 6071 | 51.3 | 1.56, 1.58, 1.58 |
| 42532728025 | 2026-11-08 22:57 | `061d298f` | 741 | 4484 | 37.8 | 1.08, 1.14, 1.12 |
| 42536155358 | 2026-11-08 23:38 | `9f1e4b65` | 747 | 4524 | 38.2 | 1.09, 1.11, 1.13 |
| 42539550346 | 2026-11-09 00:19 | `46ab3d0c` | 753 | 5510 | 46.5 | 1.36, 1.34, 1.36 |
| 42544294851 | 2026-11-09 01:12 | `424004e3` | 754 | 7366 | 62.2 | 1.78, 1.78, 1.82 |
| 42558001432 | 2026-11-09 03:44 | `04239180` | 785 | 8035 | 67.8 | 1.81, 1.83, 1.93 |
| 42571630780 | 2026-11-09 06:12 | `3f822c64` | 785 | 7716 | 66.7 | 1.82, 1.78, 1.90 |
| 42587417056 | 2026-11-09 08:38 | `5d16c289` | 785 | 5734 | 48.7 | 1.34, 1.34, 1.38 |

In the same runs the `browser (viewer-engine)` test step took 12.9, 13.1, 9.5, 9.7, 9.2 and 11.1 minutes for the runs started at 21:26, 22:00, 23:38, 01:12, 06:12 and 08:38, and `browser (golden-images)` took between 3.6 and 5.5 minutes.

### Per-spec sum of test times before the change, the 16 slowest specs (s)

| Spec | 2026-11-08 21:26 | 2026-11-08 23:38 | 2026-11-08 22:00 | 2026-11-09 06:12 | 2026-11-09 08:38 |
|---|---|---|---|---|---|
| full-viewer | 174.3 | 205.9 | 282.2 | 364.8 | 260.2 |
| guided-review | 156.4 | 177.8 | 246.2 | 280.7 | 208.3 |
| viewer-tools | 139.5 | 154.5 | 224.2 | 264.4 | 192.2 |
| settings | 114.1 | 133.6 | 175.0 | 255.2 | 189.7 |
| select | 123.8 | 152.4 | 204.1 | 235.9 | 169.1 |
| marker-tools | 121.2 | 135.5 | 201.3 | 224.9 | 167.5 |
| admin-and-onboarding | 115.5 | 125.5 | 176.7 | 222.9 | 164.6 |
| comment-pins | 96.1 | 112.9 | 168.4 | 221.8 | 134.5 |
| issue-states | 116.4 | 127.9 | 185.3 | 165.9 | 158.0 |
| drag-shapes | 83.0 | 90.0 | 135.5 | 164.0 | 114.7 |
| disagreements | 86.8 | 93.4 | 132.7 | 154.7 | 120.7 |
| project-upload | 76.9 | 82.5 | 119.9 | 152.9 | 113.6 |
| magnification-bar | 79.0 | 86.1 | 126.1 | 146.7 | 107.3 |
| annotate-task | 78.5 | 87.2 | 125.2 | 139.7 | 103.4 |
| polygon | 74.2 | 82.7 | 125.1 | 139.4 | 105.5 |
| review-popovers | 68.1 | 76.2 | 109.0 | 131.0 | 95.1 |

Spec files that are new since 2026-11-08 21:26 add these sums in the run of 2026-11-09 06:12: cell-focus 76.5, auto-region 76.1, tools-layout 70.4, layout-settings 69.1, paged-review 61.6 and settings-navigation 49.0 seconds, which is 403 of 7716 seconds.

### Shard split after the change

`playwright test --list --shard=N/3` on `apps/web` at the commit of this change lists 261, 261 and 263 tests for shards 1, 2 and 3.

### After

TODO: fill in the `browser (web 1/3)`, `browser (web 2/3)` and `browser (web 3/3)` job times and the per-spec sums from the first three `ci` runs on `main` after this change.

## Interpretation

Every spec slowed by about the same factor, not a few new ones. The new spec files explain about 5 percent of the slowest run. The slowdown is flat across the first, middle and last third of each run, so nothing shared builds up over the run: no leak in a fixture, the fake API store, Chrome or the Vite module graph. The logs show no Vite dependency re-optimisation or reload lines in any run, though Playwright may not pipe every server line.

The factor is not monotonic in time or in code. The run at 22:00 was 1.56 times slower than the reference, the next two runs at 22:57 and 23:38 on newer code were only about 1.1 times slower, and the run at 08:38 took 48.7 minutes against 66.7 minutes for the run at 06:12 on almost the same code. The runner image and Chrome build did not change. So the main cause is the speed of the runner a job lands on, which varies by up to about 1.9 times, together with steady growth of the suite from 690 to 785 tests. The web suite drives two Chrome instances and a dev mode Vite server on a four vCPU runner, so it is CPU bound and feels runner speed far more than `viewer-engine` and `golden-images`, whose times stayed within a few minutes. That last point is an assumption, because the runner CPU model is not in the logs. A small app-wide slowdown after 23:38 cannot be ruled out from this data, since the runs after it never dropped back to 1.1.

The fix is to split `browser (web)` into three matrix jobs with Playwright `--shard`, which runs each third on its own runner. The repository is public, so the extra jobs cost no Actions minutes. With the slowest run's 7716 seconds of test time split three ways over two workers, a shard would need about 21 minutes plus setup, if the shards are even.

## Follow-ups

- TODO: the lead fills in the "After" section from three `ci` runs on `main` and checks each shard is under 45 minutes.
- If shards still drift, print `nproc` and `lscpu` model name in the job to tie slow runs to a CPU type, and consider running the suite against a production build with `vite preview` instead of the dev server.
