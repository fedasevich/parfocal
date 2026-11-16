# Result: application performance on six main paths

- Date: 2026-11-16
- Backlog: TEST-019 (application performance on main paths)
- ADR: [XXXX](../adr/XXXX-main-path-budgets-are-a-p95-after-a-warm-up.md) (main path budgets are a p95 after a warm-up)
- Budgets fixed in commit `601bef49` before the first measured run, in `perf-budgets.json`.

## Question

How fast are the main paths of the application against budgets set before measuring, as the median and p95 of repeated runs after a warm-up?

## Machine and conditions

- Apple M4, 10 cores, 24 GiB, macOS 15.8.1, Google Chrome 157.0.8103.51 headless, Python 3.14.10, Postgres 17 with PostGIS and MinIO in Docker from `compose.yaml`.
- **The Mac was shared** with three other agents, one of them running ML work. Before every run a script waited for at least 5 GiB of free, inactive and speculative memory and logged it. Every run started with 7.6 to 9.8 GiB available and a one-minute load average of 3.7 to 15.9.
- Only small fixture data: CMU-1.svs from the test fixtures, generated GeoJSON cells and a synthetic slide.

## Method

- One warm-up run, which is dropped, then a fixed number of runs. The median is the middle value, or the mean of the two middle values. The p95 is the nearest-rank 95th percentile, so with 5 runs it is the slowest run and with 20 to 24 runs it is the second slowest.
- **Open and jump.** `PARFOCAL_MAIN_PATH_RUNS=20 pnpm exec playwright test browser/budgets.spec.ts -g "main path" --workers=1` in `packages/viewer-engine`. It uses the TEST-006 (performance budget suite) harness: the primary Viv route with SwiftShader WebGL at 1280 x 720, six decode workers, CMU-1.svs served from the test fixtures through the latency proxy at 50 ms RTT. Open is from creating the engine to the fitted view being idle. Jump is from setting the camera to 10x at the tissue centre to the view being sharp and idle. The renderer reads the file over HTTP range requests, so this path has no API or database in it.
- **Import.** `PARFOCAL_MAIN_PATH_CELLS=N PARFOCAL_MAIN_PATH_RUNS=R uv run pytest apps/api/tests/test_large_result_imports.py -m db -k main_path_import`. Each run uploads a generated GeoJSON of N cells through the API multipart upload, onto a new slide, and a real `python -m parfocal_ingest` worker process imports it into Postgres and MinIO. The time is the import job's step, from `started_at` to `finished_at`, so worker start-up and polling are not in it. Peak memory is the worker's maximum resident set from `/usr/bin/time -l`.
- **Model run.** `PARFOCAL_MAIN_PATH_MODEL_RUNS=10 uv run pytest workers/ml/tests/test_whole_slide_main_path.py -k main_path_whole_slide`. **The model is the CPU stand-in `StainMaps` from the ML tests, not PathoSAM.** Everything around it is the real worker code: `plan_tiles`, `PathoSamDetector` reading tiles, outline tracing on the stand-in maps, `run_tiles` encoding one chunk per tile and writing it to local MinIO. The slide is synthetic, 9216 x 6144 px at 0.25 um/px with a nucleus every 40 px, 3.54 mm2 in 24 tiles of 1536 px, all of them tissue. The job database is left out: progress is kept in memory.
- **Decision to next object.** `PARFOCAL_MAIN_PATH_ROUNDS=6 pnpm exec playwright test e2e/decision-next-object.spec.ts --workers=1` in `apps/web`, against the production build with the in-browser fake API at 1440 x 900. Each round opens the annotate task slide in a fresh browser context, starts the guided check and agrees with C1 to C4 by pressing `d`. The time is from the key event's time stamp to the second animation frame after `data-current` names the next object, so it includes one painted frame. The camera flight that follows is not counted. The first round is the warm-up.

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
- The whole-slide run took 21.7 to 64.3 s for 3.54 mm2, 6.1 to 18.2 s/mm2. It found 34,808 nuclei every time, a median of 0.55 tiles and 800 nuclei a second. The first four runs took 22 to 28 s and the last five 54 to 64 s, so the load of the other agents doubled the time halfway through.
- Decisions took 42 to 70 ms.

## CI checks

The CPU-side paths have `ms` budgets under ADR 0154 (one budget file and the regression rule), asserted on the fastest of several samples:

| Budget id | Test | Local baseline | Limit |
|---|---|---:|---:|
| `app.import-10k-cells-ms` | `apps/api/tests/test_large_result_imports.py`, db job | 1,374 ms | 4,100 ms |
| `app.model-run-stand-in-ms` | `workers/ml/tests/test_whole_slide_main_path.py`, one 1536 px tile | 763 ms | 2,200 ms |
| `app.decision-next-object-ms` | `apps/web/e2e/decision-next-object.spec.ts`, 8 decisions | 42 ms | 126 ms |

A second local run measured 1,269 ms, 968 ms and 40 ms. Open and jump are already asserted in CI by the TEST-006 budgets at 200 ms RTT.

## Conclusion

- Facts: five of the six paths are within their budget on a shared M4, the closest is decision to next object at 70 percent of its budget. The work around the nuclei model is over budget by three to nine times before any real model runs.
- Interpretation: the outline tracing and chunk encoding, single-threaded on the CPU, would at the median take about 21 minutes for 100 mm2 of tissue, more than the 17 minutes per slide the catalogue gives the whole nuclei model.
- Assumptions: the open and jump paths read the slide file directly and do not go through the API tile route or sign-in, the decision path uses the fake API, and the model is a stand-in, so none of these three is a measurement of the deployed stack.
- TODO: measure open, jump and decision against the local stack with sign-in and the real API, and the whole-slide run with PathoSAM on a GPU and on a quiet machine.
