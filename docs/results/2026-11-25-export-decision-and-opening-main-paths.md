# Result: export, decision and opening on the local stack

- Date: 2026-11-25
- Backlog: TEST-060 (the main paths the performance measurement still lacks), after TEST-019 (application performance on main paths)
- ADR: [0353](../adr/0353-main-path-budgets-are-a-p95-after-a-warm-up.md) (main path budgets are a p95 after a warm-up)
- Budgets fixed in `perf-budgets.json` in commit `9c280622`, before the first measured run.

## Question

How long does a researcher wait for the export of a signed-off slide, as a QuPath GeoJSON zip and as COCO patches, and how fast are a decision and opening a slide on a production build through the real API and the application's own slide delivery, against budgets set before measuring?

## Budgets

Fixed before any timing code ran. Each is a limit for the p95.

| Budget id | Path | Limit | How it was chosen |
|---|---|---:|---|
| `app.export-geojson-1k-p95-ms` | Training dataset zip, 1,000 annotations | 2,000 ms | A download the researcher clicks and waits on, with no progress shown. Two seconds is the longest wait for a plain download that does not need a progress bar. |
| `app.export-geojson-10k-p95-ms` | Training dataset zip, 10,000 annotations | 5,000 ms | The same limit TEST-019 set for importing 10,000 cells. Writing the objects out should not take longer than reading them in. |
| `app.export-coco-1k-p95-ms` | COCO patches, 1,000 annotations | 15,000 ms | A job with a progress dialog, so a longer wait is fine. A quarter of the 60 s TEST-019 allowed for the largest import. |
| `app.export-coco-10k-p95-ms` | COCO patches, 10,000 annotations | 30,000 ms | Half of that 60 s. The pixels cut are the same as at 1,000, only the masks and the COCO file grow. |
| `app.open-production-ready-p95-ms` | Open, navigation to ready | 3,000 ms | Unchanged from TEST-019, so the production build is judged by the same line as the dev server. |
| `app.decision-production-p95-ms` | Decision to the next object | 100 ms | Unchanged from TEST-019, which the real API missed on the dev server. |

## Machine and conditions

- Apple M4, 10 cores, 24 GiB, macOS 15.8.1, Google Chrome 158.0.8127.88 headless through Playwright 1.65.1, Python 3.14.10, wrangler 4.161.0. Postgres 18.4 with PostGIS and MinIO in Docker.
- **The Mac was shared** with other agents. The scripts logged free, inactive and speculative memory and the load average before and after each part. The 1,000 annotation exports started at 8,107 MiB available and a one-minute load of 3.50 and ended at 8,077 MiB and 3.50. The 10,000 annotation exports started at 8,093 MiB and 4.40 and ended at 8,446 MiB and 7.76. The production build run started at 7,922 MiB and 6.29 and ended at 9,193 MiB and 8.73.
- Everything ran on loopback, with no added latency, no cloud service and no deployed app.

## Method

- One warm-up, which is dropped, then a fixed number of runs. The median is the middle value, or the mean of the two middle values. The p95 is the nearest-rank 95th percentile, the value at rank ceil(0.95 n) in ascending order: with 20 runs the 19th, so the second slowest, with 24 runs the 23rd, so the second slowest, and with 48 runs the 46th, so the third slowest.

### Exports

- `bash scripts/main-path-exports.sh` runs `apps/api/tests/test_export_main_paths.py` once with 1,000 and once with 10,000 annotations, 20 runs each. It skips itself unless `PARFOCAL_MAIN_PATH_ANNOTATIONS` is set, so CI does not run it.
- It uses the db test harness of TEST-019: a fresh migrated database on the shared local Postgres, the API in process through the FastAPI test client, and a real `python -m parfocal_ingest` worker process from `test_large_result_imports.py`, started before the first COCO export and kept running with a 0.1 s poll.
- The slide is CMU-1-Small-Region.svs, 2,220 x 2,967 px, stored in local MinIO as the slide's original. An annotate task over it gets N square regions of class Tumour in an even grid through the shared layer import (`POST .../shared-layer/imports`, the app's own import), then the reviewer checks the slide and the researcher signs it off.
- GeoJSON is the training dataset export, `GET /api/review-tasks/{id}/training-dataset`, the "Training dataset (QuPath GeoJSON zip)" choice of the task export menu. The time is from sending the request to the last byte of the zip received.
- COCO is the patch export with format `coco`, level 0 and 512 px tiles, the dialog's default tile. The time is from `POST .../patch-exports` through polling `.../status` every 50 ms until `done`, to the last byte of the zip from `GET .../patch-exports/{job}`. The web dialog itself polls on a timer, so a user sees the file up to one poll interval later. The job step time from `job_steps` is recorded beside it.
- Data sizes: the 1,000 annotation zip is 55,057 bytes and the 10,000 one 553,853 bytes. The 1,000 annotation COCO zip is 6.1 MB with 30 tiles and 1,162 COCO annotations, because an annotation that crosses a tile edge is one annotation per tile.

### Opening and decision

- `bash scripts/main-paths-production.sh` builds `apps/web` with plain `vite build` and `PARFOCAL_PUBLIC_APP_ENV=test`, so with no fake API and no developer tools. It brings up the local stack under its own compose projects `t060` and `t060-zitadel` on their own ports: Postgres with PgBouncer and MinIO, the API container and ingest worker from `infra/local/stack.compose.yaml`, and the local Zitadel. It raises the API's per person and per tenant rate limits to 100,000 a minute, as TEST-019 did. It removes every container and volume it made when it ends.
- **The build is served by the edge Worker**, `wrangler dev --local` with `apps/edge/wrangler.jsonc`, as the deployed app is: the Worker serves the built assets, proxies `/api/` to the API and serves `/tiles/` from its R2 binding. The bucket is wrangler's simulated local R2, never the real one. The script derives the files the ingest writes for CMU-1.svs, the slide of 46,000 x 32,914 px and 177,552,579 bytes, with the ingest's own code (`levels.json`, tile index, overview levels, thumbnails and restricted ranges), puts them under the app's fixture folder `fixture-slides/CMU-1-svs/` in that bucket, and puts the restricted ranges into MinIO, where the API reads them for the tile grant.
- The spec is TEST-019's `apps/e2e/tests/main-paths.spec.ts` with the config `apps/e2e/playwright.production.config.ts`, run with `--workers=1` and 8 rounds after a warm-up round. It signs in once through the app's own sign-in page against the local Zitadel. Each round makes a new researcher workspace, the sample project and an annotate task over three of its slides, whose originals point to CMU-1.svs. That gives 24 opens and 48 decisions.
- Open is navigation to ready, from the start of the page load to the stage turning `ready`, so it holds loading the app, the session check, every API call before the image, the tile grant and the fitted image. Stage to fitted and jump are the same numbers as in TEST-019. Decision is from the `d` key event to the second animation frame after the next object is current, and it holds the confirm request to the real API and the shared layer fetched again.
- Cache state: every open is a new slide id, so its tile URLs are new to the browser. The edge Worker's range cache keys on the stored file and range, so after the warm-up round it holds most ranges. Of 786 tile responses, 739 were edge cache hits and 47 misses. The slide file was on the local disk.
- No request was answered 429. The API answered 503 to the 28 realtime room access requests, because the local stack has no room service. Every measured open and decision completed without them.

## Results

| Path | Runs | Median | p95 | Budget for the p95 | Within |
|---|---:|---:|---:|---:|---|
| Training dataset GeoJSON zip, 1,000 annotations | 20 | 38 ms | 49 ms | 2,000 ms | yes |
| Training dataset GeoJSON zip, 10,000 annotations | 20 | 386 ms | 476 ms | 5,000 ms | yes |
| COCO patches, 1,000 annotations | 20 | 1,767 ms | 1,850 ms | 15,000 ms | yes |
| COCO patches, 10,000 annotations | 20 | no file | no file | 30,000 ms | **no** |
| Open CMU-1.svs, navigation to ready, production build | 24 | 1,180 ms | 1,281 ms | 3,000 ms | yes |
| Decision to the next object, production build, real API | 48 | 42.7 ms | 65.0 ms | 100 ms | yes |

- The GeoJSON exports ranged 29 to 127 ms at 1,000 annotations and 251 to 494 ms at 10,000. A first run of the 10,000 annotation part is not counted, because it did not yet record why the patch export skipped the slide. It measured a GeoJSON median of 342 ms and p95 of 349 ms and the same empty COCO export.
- The COCO export at 1,000 annotations ranged 1,712 to 1,868 ms, with a job step of 1,626 to 1,777 ms and a median of 1,648 ms, so the poll and the download added about 0.1 s.
- **The COCO export at 10,000 annotations produced no patches.** All 20 runs finished as `done` in 2,327 to 3,400 ms with a zip of 1,027 to 1,030 bytes, no image and no COCO annotation, and a manifest that lists the slide as skipped for `unreadable` in every run. The patch cut runs in the ingest's isolated parse process, which returns its facts, the COCO annotations among them, to the worker as one message capped at 1 MiB (`MAX_MESSAGE_BYTES` in `workers/ingest/src/parfocal_ingest/isolation.py`). Calling the same `patch_slide` in process on the same grid gave a result message of 3,050,085 bytes at 10,000 annotations and 347,721 bytes at 1,000, and it cut all 30 tiles in 1.04 s. The worker turns the refused message into `unreadable` and skips the slide without an error.
- Stage to fitted was 927 to 1,067 ms, median 952 ms and p95 1,051 ms. Jump to a sharp 10x view at the slide centre was 404 to 445 ms, median 428 ms and p95 443 ms. Open ranged 1,143 to 1,363 ms and decisions 34.6 to 85.3 ms.

## Conclusion

- Facts: on a shared M4 with everything local, five of the six paths are within their budgets. The GeoJSON zip of 10,000 annotations takes 10 percent of its budget and the COCO patches of 1,000 annotations 12 percent. Opening CMU-1.svs on the production build through the edge Worker takes 43 percent of its budget, and a decision through the real API 65 percent. The COCO export of 10,000 annotations does not produce a file, because the cut slide's facts are larger than the 1 MiB message the isolated parse may send back, and the user gets an empty export marked done.
- Facts compared with TEST-019: on the Vite dev server through the real API, a decision had a p95 of 242 ms and opening a 1024 x 768 synthetic slide a p95 of 3,037 ms. On the production build behind the edge Worker, a decision has a p95 of 65.0 ms and opening the much larger CMU-1.svs 1,281 ms.
- Interpretation: the dev server, not the real API, made most of the gap TEST-019 found, because the production build answers within budget with the same confirm request and shared layer fetch. The COCO limit is most likely crossed somewhere between 1,000 and 10,000 annotations on one slide, since the message grew about tenfold between the two, but no count in between was measured.
- Assumptions: loopback has no network latency, the edge range cache was mostly warm and the slide was on a local disk, so a deployed open over R2 and the internet will be slower. The API ran in process for the exports and in a container for the browser runs. The realtime room service was missing, which the deployed app has.
- TODO: make the patch export return its COCO facts in the output file instead of the message, or fail visibly, then measure the 10,000 annotation COCO export again. Measure opening on a deployed staging stack with network latency and a cold edge cache.
