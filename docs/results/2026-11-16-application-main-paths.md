# Result: application performance on six main paths

- Date: 2026-11-16
- Backlog: TEST-019 (application performance on main paths)
- ADR: [XXXX](../adr/0353-main-path-budgets-are-a-p95-after-a-warm-up.md) (main path budgets are a p95 after a warm-up)
- Budgets fixed in commit `601bef49` before the first measured run, in `perf-budgets.json`.

## Question

How fast are the main paths of the application against budgets set before measuring, as the median and p95 of repeated runs after a warm-up?

## Machine and conditions

- Apple M4, 10 cores, 24 GiB, macOS 15.8.1, Google Chrome 157.0.8103.51 headless, Python 3.14.10, Postgres 18 with PostGIS 3.6.1 and MinIO in Docker from `compose.yaml`.
- **The Mac was shared** with three other agents, one of them running ML work. Before every run a script waited for at least 5 GiB of free, inactive and speculative memory and logged it. Every run started with 7.6 to 9.8 GiB available and a one-minute load average of 3.7 to 15.9.
- Only small fixture data: CMU-1.svs from the test fixtures, generated GeoJSON cells and a synthetic slide.

## Method

- One warm-up run, which is dropped, then a fixed number of runs. The median is the middle value, or the mean of the two middle values. The p95 is the nearest-rank 95th percentile, so with 5 or 10 runs it is the slowest run and with 20 to 24 runs it is the second slowest.
- Open and jump ran with `PARFOCAL_MAIN_PATH_RUNS=20 pnpm exec playwright test browser/budgets.spec.ts -g "main path" --workers=1` in `packages/viewer-engine`. It uses the TEST-006 (performance budget suite) harness: the primary Viv route with SwiftShader WebGL at 1280 x 720, six decode workers, CMU-1.svs served from the test fixtures through the latency proxy at 50 ms RTT. Open is from creating the engine to the fitted view being idle. Jump is from setting the camera to 10x at the tissue centre to the view being sharp and idle. The renderer reads the file over HTTP range requests, so this path has no API or database in it.
- The imports ran with `PARFOCAL_MAIN_PATH_CELLS=N PARFOCAL_MAIN_PATH_RUNS=R uv run pytest apps/api/tests/test_large_result_imports.py -m db -k main_path_import`. Each run uploads a generated GeoJSON of N cells through the API multipart upload, onto a new slide, and a real `python -m parfocal_ingest` worker process imports it into Postgres and MinIO. The time is the import job's step, from `started_at` to `finished_at`, so worker start-up and polling are not in it. Peak memory is the worker's maximum resident set from `/usr/bin/time -l`.
- The model run ran with `PARFOCAL_MAIN_PATH_MODEL_RUNS=10 uv run pytest workers/ml/tests/test_whole_slide_main_path.py -k main_path_whole_slide`. **The model is the CPU stand-in `StainMaps` from the ML tests, not PathoSAM.** Everything around it is the real worker code: `plan_tiles`, `PathoSamDetector` reading tiles, outline tracing on the stand-in maps, `run_tiles` encoding one chunk per tile and writing it to local MinIO. The slide is synthetic, 9216 x 6144 px at 0.25 um/px with a nucleus every 40 px, 3.54 mm2 in 24 tiles of 1536 px, all of them tissue. The job database is left out: progress is kept in memory.
- Decision to next object ran with `PARFOCAL_MAIN_PATH_ROUNDS=6 pnpm exec playwright test e2e/decision-next-object.spec.ts --workers=1` in `apps/web`, against the production build with the in-browser fake API at 1440 x 900. Each round opens the annotate task slide in a fresh browser context, starts the guided check and agrees with C1 to C4 by pressing `d`. The time is from the key event's time stamp to the second animation frame after `data-current` names the next object, so it includes one painted frame. The camera flight that follows is not counted. The first round is the warm-up. The live panel moves to the next object only after the confirm request has resolved and the shared layer has been fetched again, so the time holds two fake API calls that answer inside the browser with no network.

## Results

| Path | Runs | Median | p95 | Budget for the p95 | Within |
|---|---:|---:|---:|---:|---|
| Open CMU-1.svs to the fitted image, 50 ms RTT | 20 | 1,562 ms | 1,596 ms | 3,000 ms | yes |
| Jump to a sharp 10x viewport, 50 ms RTT | 20 | 966 ms | 998 ms | 2,500 ms | yes |
| Import 10,000 cells | 20 | 1,626 ms | 1,943 ms | 5,000 ms | yes |
| Import 1,000,000 cells | 5 | 15,798 ms | 19,215 ms | 60,000 ms | yes |
| Whole-slide run with the stand-in model | 10 | 12.8 s/mm2 | 18.2 s/mm2 | 2.0 s/mm2 | **no** |
| Decision to the next object on screen | 24 | 58.7 ms | 70.0 ms | 100 ms | yes |

- Open ranged 1,392 to 1,616 ms and jump 949 to 1,000 ms.
- The 10,000 cell import ranged 1,374 to 2,070 ms with a worker peak of 260 to 282 MiB. The 1,000,000 cell import ranged 14,323 to 19,215 ms with a worker peak of 594 to 629 MiB. A 1.6 million cell file took 42 to 45 s in the bounded import result of 2026-11-01, so the 1,000,000 cell time fits that line.
- The whole-slide run took 21.7 to 64.3 s for 3.54 mm2, 6.1 to 18.2 s/mm2. It found 34,808 nuclei every time, a median of 0.55 tiles and 800 nuclei a second. The runs fall in two groups, the first five at 6.1 to 10.3 s/mm2 and the last five at 15.3 to 18.2 s/mm2, so the median of 12.8 lies between them.
- A separate timing of the one-tile CI case, three runs after a warm-up, found that the stand-in's own maps took 113 to 117 ms of 742 to 781 ms, 15 percent. The other 85 percent is the worker code around the model.
- Decisions took 42 to 70 ms.

## Open, jump and decision against the local stack

The same budgets, measured a second time through the whole local stack on the same day.

- Machine and conditions are as above, the same shared M4 and Chrome. The stack ran under its own compose projects `t019` and `t019-zitadel`: Postgres with PgBouncer and MinIO from `compose.yaml`, the local Zitadel from `infra/local/zitadel.compose.yaml`, the API under uvicorn and the web app on the **Vite dev server**, as `apps/e2e` starts them. No production build was measured, because the e2e build mode bundles the fake API.
- The spec is `apps/e2e/tests/main-paths.spec.ts`, run with `PARFOCAL_MAIN_PATH_ROUNDS=8 pnpm exec playwright test tests/main-paths.spec.ts --workers=1`. It skips itself when the variable is unset, so CI does not run it. It signs in once through the app's own sign-in page against the local Zitadel and keeps the session for every round. Sign-in is not timed.
- Each round creates a researcher workspace, the sample project through `POST /api/projects/sample` and an annotate task over three of its slides through `POST /api/projects/{id}/review-tasks`, so every decision lands on fresh objects. One warm-up round is dropped, which leaves 24 slide opens and jumps and 48 decisions.
- **The slide is the 1024 x 768 synthetic JPEG TIFF** from the test fixtures, 3 levels at 0.5 um/px, served by the Vite fixture tile route. Its key is set in the database as the polygon e2e spec does. Without `PARFOCAL_EDGE_DEV=on` there is no local edge Worker, and the edge Worker reads only the remote `parfocal-dev` bucket. So the slide bytes skip the edge and R2, and the slide is far smaller than CMU-1.svs in the rows above. Every other request, the tile grant, annotations, the shared layer, decisions and coverage, went to the real API, Postgres and MinIO.
- Open has two numbers. Navigation to ready is from the start of the page load to the stage turning `ready`, so it includes loading the app, the session check and every API call before the first fitted image. Stage to fitted is the stage's own `data-fitted-ms`, from the stage mounting to the fitted view being idle, which includes the tile grant from the API.
- Jump is the new `window.__parfocal.jumpTo` debug member, which sets the camera to 10x at the slide centre and waits for the shown route to be idle, as the TEST-006 harness does.
- Decision is the timing of the fake API spec: from the `d` key event to the second animation frame after `data-current` names the next object. It holds the confirm request to the API and the shared layer fetched again. The camera flight to each object cancels on a key press, so the spec waits until no flight is shown before pressing.
- The API's per person rate limit of 600 requests a minute answered 429 after about four rounds at the spec's pace, so the runs set `RATE_LIMIT_PERSON_PER_MINUTE` and `RATE_LIMIT_TENANT_PER_MINUTE` to 100000.

| Path | Runs | Median | p95 | Budget for the p95 | Within |
|---|---:|---:|---:|---:|---|
| Open, navigation to ready, synthetic slide | 24 | 2,376 ms | 3,037 ms | 3,000 ms | **no** |
| Open, stage to fitted, synthetic slide | 24 | 839 ms | 1,052 ms | 3,000 ms | yes |
| Jump to a sharp 10x viewport, synthetic slide | 24 | 14.6 ms | 25.8 ms | 2,500 ms | yes |
| Decision to the next object on screen, real API | 48 | 153 ms | 242 ms | 100 ms | **no** |

- This run started at 8.3 GiB available and a one-minute load average of 25.0 and ended at 9.8 GiB and 21.7. Navigation to ready ranged 2,003 to 3,178 ms, stage to fitted 678 to 1,145 ms, jump 8 to 32 ms and decisions 93 to 278 ms.
- An earlier run of the same spec is not counted. Its load average rose from 15 to 106 during the run, partly from a busy wait loop of this agent, and it measured medians of 5,534 ms, 1,504 ms, 12 ms and 243 ms with p95s of 8,848 ms, 3,255 ms, 24 ms and 485 ms.

## CI checks

The CPU-side paths have `ms` budgets under ADR 0154 (one budget file and the regression rule), asserted on the fastest of several samples:

| Budget id | Test | Local baseline | Limit |
|---|---|---:|---:|
| `app.import-10k-cells-ms` | `apps/api/tests/test_large_result_imports.py`, db job | 1,374 ms | 5,000 ms |
| `app.model-run-stand-in-ms` | `workers/ml/tests/test_whole_slide_main_path.py`, one 1536 px tile | 763 ms | 2,200 ms |
| `app.decision-next-object-ms` | `apps/web/e2e/decision-next-object.spec.ts`, 8 decisions | 42 ms | 126 ms |

A second local run measured 1,269 ms, 968 ms and 40 ms. None of the three limits has run on a hosted runner yet, and the db job runs with four pytest workers, so the import limit of three times an M4 baseline may be tight there. On 2026-11-18 it was: CI run 44249901062 measured 4,349 ms against the old 4,100 ms limit with no change to the import code, so the budget now uses that runner number as its baseline and the thesis budget of 5,000 ms as its limit. Open and jump are already asserted in CI by the TEST-006 budgets at 200 ms RTT.

## Conclusion

- Facts: five of the six paths are within their budget on a shared M4, the closest is decision to next object at 70 percent of its budget. The whole-slide run with the stand-in is over its budget by three to nine times, and the code around the model alone, 85 percent of the time, is still over it by about 2.6 to 7.7 times.
- Interpretation: at 5 to 15 s/mm2 for the work around the model, an assumed 100 mm2 of tissue takes 9 to 26 minutes before the model itself. The 17 minutes per slide in the model catalogue is the frozen mock's placeholder, not a measurement, but the work around the model alone would use most or all of it. Which part of the 85 percent dominates was not profiled.
- Facts from the local stack: with a real sign-in and the real API, a decision takes 153 ms at the median and 242 ms at the p95, about two and a half times the 100 ms budget, and the median is about two and a half times the fake API median of 58.7 ms. Opening a slide from a fresh page load is just over its budget at a p95 of 3,037 ms on the dev server, while the stage itself fits in 1,052 ms. Jump is within budget, but on a slide this small it measures almost nothing.
- Interpretation: the gap between the fake and the real decision is the confirm request and the shared layer fetched again before the panel moves on, so moving to the next object before the confirm resolves would most likely bring it under budget. This was not tested. The dev server serves unbundled modules, so a production build would most likely open faster.
- Assumptions: the two groups of model runs most likely come from the load of the other agents, but load was logged only before each script, not during it. The imports and the local stack runs went through the API, Postgres and MinIO. The local stack runs used a synthetic slide from the Vite fixture route instead of the edge Worker and R2, and the dev server instead of a build. Open and jump on CMU-1.svs read the file directly, and the model is a stand-in, so none of these is a measurement of the deployed stack.
- TODO: measure open and jump on CMU-1.svs through the edge Worker with a local bucket or on a staging deploy, the decision path on a production build, and the whole-slide run with PathoSAM on a GPU and on a quiet machine.
