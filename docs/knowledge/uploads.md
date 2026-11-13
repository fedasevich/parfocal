# Uploads

How large slide uploads reach storage, and what the STACK-039 (resumable upload protocol) spike found. The protocol is in [ADR 0116](../adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md) (resumable uploads with S3 multipart and Uppy) and the numbers are in the [result file](../results/2026-10-31-resumable-upload-spike.md). INGEST-028 (upload protocol check on the R2 dev bucket) checked the R2 entries against `parfocal-dev` on 2026-11-02 ([result](../results/2026-11-02-upload-protocol-check-on-r2.md)).

## The API creates and completes uploads, whatever R2 can presign

The R2 docs say it presigns GET, HEAD, PUT and DELETE only, but a presigned CreateMultipartUpload `POST` answered 200 and created an upload on 2026-11-02. Use Uppy's Companion mode anyway: the browser sends only part `PUT` requests to R2, and the API creates, lists, completes and aborts with its own credentials, because it must check the tenant, choose the key, record the upload and check part sizes, and because `signRequest` mode reads only the first ListParts page. Source: https://developers.cloudflare.com/r2/api/s3/presigned-urls/ and ADR 0116 (resumable uploads with S3 multipart and Uppy).

## R2 refuses uneven parts and MinIO does not

R2 requires every part except the last to have the same size and fails the completion otherwise, with the S3 code `InvalidPart` and "All non-trailing parts must have the same length.". The docs call it error 10048, but that number is not in the S3 answer, so match on the code. MinIO completed an upload of 16 MiB, 15 MiB and 9 MiB parts without complaint in the spike. A local test against MinIO therefore proves nothing about part sizes, and the API must check the listed part sizes against the stored part size before it completes. `partsProblem` in `packages/upload-spike/src/part-size.ts` is that check.

## An expired R2 URL looks like a network error in the browser

R2 answers an expired presigned URL with 403 `ExpiredRequest` and no CORS headers, so the browser cannot read the status (confirmed on 2026-11-02). MinIO's 403 for an expired URL carried CORS headers in the spike, so a local test cannot reproduce this. Sign part URLs one at a time just before use, and treat a failed part as "list the stored parts and sign again", which Uppy already does when a file is retried.

## R2 refuses part checksums

R2 answers `NotImplemented` to `x-amz-checksum-sha256` on UploadPart, also when the upload was created with `ChecksumAlgorithm` SHA256. Send no `x-amz-checksum-*` header to R2. AWS SDK v3 adds CRC32 checksums by default, so a JavaScript S3 client for R2 needs `requestChecksumCalculation` and `responseChecksumValidation` set to `WHEN_REQUIRED`. The Python client in `parfocal_common.object_store` signs by hand and sends none. Integrity rests on the part MD5 ETags and the SHA-256 the ingest worker computes.

## Testing CORS in Playwright needs a real listener

Playwright answers CORS preflights itself while request interception is on, so a page served by `page.route` never sees the storage's own preflight answer, and Chromium treats such a page as public and refuses requests from it to a loopback proxy. Serve the page from a server on the origin under test, as `--target r2` of the upload spike does on port 5173.

## Uppy 6 behaviour that matters

- `@uppy/aws-s3` 6 sends the parts of one file one at a time. `limit` only sets how many files upload at once, so one large slide pays round trips for every part: the signature, a CORS preflight, because each presigned URL is new and the preflight cache is keyed by URL, and the `PUT`. The spike saw 2 storage requests per part and used 77 to 80% of the link at a 50 ms round trip.
- A failed part `PUT` is retried 3 times after 150, 300 and 600 ms, a part with no upload progress for 30 s is aborted, and then the file gets `upload-error`. The `retryDelays` option is gone in version 6. Calls to the Companion routes are not retried.
- Retrying a file, or starting a file whose `s3Multipart` state holds a key and upload ID, calls the list route and sends only the missing parts. Setting that state with `setFileState` after the user picks the file again is how a reloaded page resumes.
- In `signRequest` mode, ListParts reads only the first page of the response, so an upload with more parts than one page would send stored parts again. Companion mode leaves listing to the API, which must paginate.
- The `uppy` package ships a full browser bundle at `dist/uppy.min.mjs`, which the spike serves as is. `@uppy/aws-s3` cannot run in plain Node, because it uploads through `XMLHttpRequest`.

## The official MinIO images are gone

`minio/minio` on Docker Hub and `quay.io/minio/minio` no longer pull (checked on 2026-10-31). The spike uses `pgsty/minio`, a community build of MinIO `RELEASE.2026-08-04T00-00-00Z`, pinned by digest in `packages/upload-spike/scripts/spike.ts`. MinIO takes its CORS origin from `MINIO_API_CORS_ALLOW_ORIGIN` rather than a bucket policy, exposes `ETag` by default, and refused a lifecycle rule with `AbortIncompleteMultipartUpload` as malformed XML while it accepted an `Expiration` rule.

## Throttling and cutting an upload with the latency proxy

`@parfocal/latency-proxy` limits request bodies with `uplinkBytesPerSecond` and counts them in `stats().uploadedBytes`. Closing the proxy destroys every socket, which the browser sees as a dropped connection, and a new proxy on the same port brings the link back. The proxy rewrites `Host` to its target, so a presigned URL must be signed for the storage server's real address and only its origin swapped to the proxy, or the signature fails. After a page is closed, bytes already buffered keep arriving at the proxy for a moment, so wait about a second before reading the counter.

## Playwright can hand a 4 GiB file to a page

`page.setInputFiles` with a 4 GiB file worked in headless Chromium from Playwright 1.64, and Uppy sliced it into parts. Browser memory was not measured. The file has to be picked again after a reload, as in a real browser.

## The upload API

INGEST-001 (upload API with presigned multipart) built the routes of ADR 0116 (resumable uploads with S3 multipart and Uppy) in `parfocal_api.uploads`. Uppy's `companionEndpoint` is `/api/uploads`, because Uppy appends `/s3/multipart` itself.

| Route | Operation | What it does |
|---|---|---|
| `POST /api/uploads/s3/multipart` | `createUpload` | Takes Uppy's `{filename, type, metadata}`. `metadata` must carry `project_id` and `size`, and may carry `case_id` and `last_modified` (the browser's `File.lastModified` in ms). Answers `{key, uploadId, part_size, part_count}` with 201 |
| `GET /api/uploads/s3/multipart/{uploadId}/{partNumber}?key=` | `signUploadPart` | Signs one part `PUT` for 15 minutes and answers `{url, expires}` |
| `GET /api/uploads/s3/multipart/{uploadId}?key=` | `listUploadParts` | Lists every stored part through all ListParts pages as `[{PartNumber, Size, ETag}]` |
| `POST /api/uploads/s3/multipart/{uploadId}/complete?key=` | `completeUpload` | Takes `{parts: [{PartNumber, ETag}]}`, checks the stored parts, completes, queues the ingest job and answers `{location, key, uploadId, job_id, etag}`. `location` is the job's status route |
| `DELETE /api/uploads/s3/multipart/{uploadId}?key=` | `abortUpload` | Aborts in storage and answers 200 `{uploadId, status}`, because Uppy parses every answer as JSON and an empty 204 would fail |
| `GET /api/uploads/open?project_id=&name=&size=&last_modified=` | `findOpenUpload` | The caller's newest open upload of that file in that project, or 404 `no-open-upload` |
| `POST /api/uploads/pairings` | `pairResultFiles` | Pairs dropped result files with dropped slides and the slides already in the case, and stores nothing. See the result files section below |
| `POST /api/uploads/sorting` | `sortDroppedFiles` | Sorts a drop into cases, loose slides, left-out duplicates and paired results, and stores nothing. See the sorting section below |
| `POST /api/uploads/sorting/apply` | `applyDroppedFiles` | Sorts the same request again and creates the new cases in one transaction |
| `PUT /api/uploads/{upload_id}/slide` | `pairUploadWithSlide` | Sets the slide or slide upload of the caller's result upload before its import starts |

- `uploadId` is our upload record's UUID, not the storage upload ID. The storage ID stays in `uploads.storage_upload_id` and only appears inside signed part URLs. Field names that Uppy reads (`uploadId`, `PartNumber`, `Size`, `ETag`, `location`, `url`) keep Uppy's spelling, the rest are snake case.
- Every route except create loads the record under the workspace's row-level security, by the creator (person or service account), and compares the `key` with the stored key. Anything else is 404 `upload-not-found`, before storage is touched, so another workspace's ids never reach R2. The caller must still hold `upload-slides` as a project owner, which `require_uploading` from the result set routes checks, so a demoted owner stops mid-upload and an archived project answers 409 `project-archived`.
- The completion check is `parts_problem` in `parfocal_common.part_plan`: parts run from 1 without gaps, every part but the last has the stored part size, the last has the rest, and the ETags sent equal the ETags stored. A refusal is 409 `upload-parts-invalid` with a detail made only of numbers, and the upload stays open so the client can send the right part and complete again. A storage refusal at completion (`InvalidPart`, `InvalidPartOrder`, `EntityTooSmall`) is the same problem, and since the job is queued in the same transaction, it is rolled back too.
- Completing twice answers the first result again. Aborting twice answers `aborted` again. Signing or listing a finished upload is 409 `upload-not-open`, and an upload that storage no longer knows is 409 `upload-gone`.
- The largest upload is `UPLOAD_MAX_BYTES`, 100 GiB by default at the owner's choice of 2026-11-02, which is 6,400 parts at 16 MiB and about fourteen times the largest fixture (7 GB). Larger is 400 `upload-too-large`. With a limit below 156.25 GiB the 16 MiB part never grows, but the growth rule is unit-tested.
- File names can hold patient names, so `uploads.file_name` and `uploads.object_key` are classed `phi`, the job input holds only the upload ID, and the audit entries (`upload.completed`, `upload.aborted`, `upload.expired`) hold ids and sizes only. The key carries a cleaned file name, as ADR 0116 (resumable uploads with S3 multipart and Uppy) decided, so it also travels in the `?key=` query of the Companion routes and in R2 request paths. Request logs keep only the route template, never the query.
- The key is `t/{tenant}/quarantine/{upload}/{name}` with the name cut to `[A-Za-z0-9._-]`, folders dropped and 120 characters kept with the extension.

## The stale upload job and the lifecycle rule

The API never sees a part `PUT`, so "no new part for 24 hours" is measured by `uploads.last_activity_at`, which create, sign and list set. A part URL lives 15 minutes, so no part can arrive more than 15 minutes after the last signature. `parfocal_api.stale_uploads.abort_stale_uploads` walks every workspace, aborts open uploads idle for 24 hours in storage, marks them `expired` and audits it. `python -m parfocal_api.stale_uploads` runs it once. TODO: schedule it hourly with the cloud cron, like the retention purge.

The R2 lifecycle rule in `infra/tofu/modules/environment/main.tf` aborts incomplete multipart uploads after 1 day on the prefix `t/`, not on the quarantine prefix. A lifecycle prefix cannot skip the tenant in `t/{tenant}/quarantine/`, and every multipart upload in the bucket is an upload in progress anyway, so the wider prefix does the same job. The bucket CORS rule of ADR 0116 (resumable uploads with S3 multipart and Uppy) is in the same file. Both are applied to `parfocal-dev` only, since 2026-11-02, and staging and production still need their own `tofu apply` at the owner's yes. The object token "parfocal-dev local" cannot read bucket settings, so read them through the Cloudflare API (`/accounts/{account}/r2/buckets/{bucket}/cors` and `/lifecycle`) with the `parfocal-tofu` token.

## Local storage is MinIO in compose

`compose.yaml` has a `storage` service with the same pinned MinIO build as the spike, on port 9000, user `parfocal` and password `parfocal-local-secret`, which are the defaults of the `STORAGE_*` settings. The password is written as the default of `${PARFOCAL_LOCAL_MINIO_PASSWORD:-...}`, because the secret scan in the pre-commit hook and the `lint` job flags a plain `MINIO_ROOT_PASSWORD` value even at low confidence. The `db` CI job starts it with the rest of the stack. The database tests create the `parfocal-test` bucket themselves, and `PARFOCAL_TEST_STORAGE_URL` points them at another MinIO, as a parallel session must when the shared stack is already running without it. A local stack started before INGEST-001 (upload API with presigned multipart) needs `pnpm db:up` once more to add MinIO, or every upload, permission and isolation test fails to connect. Nothing creates the dev bucket `parfocal-local` yet, so before `pnpm api:dev` takes an upload, run `uv run --package parfocal-api python -c "import asyncio, httpx2; from parfocal_api.settings import ApiSettings; from parfocal_common.object_store import ObjectStore; from parfocal_common.settings import load_settings; s = load_settings(ApiSettings); asyncio.run(ObjectStore(s.storage(), httpx2.AsyncClient()).create_bucket())"` with `.env` loaded. TODO: a `pnpm` script for it.

## After the upload: status, keys and the slide

INGEST-017 (publish step and slide status) runs the ingest job on the completed upload, as [ADR 0122](../adr/0122-ingest-publishes-the-slide-row-only-when-it-is-ready.md) (the slide row appears only when it is ready) decided. How the steps work is in [jobs.md](jobs.md).

- `GET /api/uploads/{upload_id}/status` (`getUploadStatus`) is the live status until STACK-024 (realtime transport) picks a push channel. Only the upload's creator reads it, like the Companion routes, and it needs `upload-slides` but not an open project, so an archived project still shows how its uploads ended. It answers `uploading` while the upload is open, `processing` with the next step to run once it is complete, `ready` with `slide_id` and the level table notices, and `failed` with `reason` and `message`. A cancelled upload is `failed` with `upload-aborted`, an expired one with `upload-expired`, a refused file with the code of `Refusal` in `parfocal_common.ingest`, such as `unknown` or `truncated`, and an ingest job that was cancelled with `check-stopped`. The codes and their plain messages live in `parfocal_common.ingest` so the API never imports the worker.
- No slide row exists before the slide is ready, so case views, Home and the review task pickers needed no change. The row carries `upload_id`, the format, variant, reader, size, level count, pixel size, objective power, notices, file size, SHA-256, `original_key`, `restricted_images` and `published_at`.
- Published keys hold no file name. The original is `t/{tenant}/s/{slide}/original{.ext}`, keeping only a known slide extension because OpenSlide needs `.ndpi` to open NDPI, and the level table, thumbnail, overview and tissue mask sit next to it. Label and macro images are under `t/{tenant}/restricted/{slide}/`, which only `getRestrictedImage` serves, as SEC-009 (slide label and macro image handling) decided in [ADR 0124](../adr/0124-labels-and-macros-only-for-whole-project-readers-in-clinical-projects.md) (labels and macros only for whole-project readers in clinical projects).
- The label is the file name without its extension, numbered "(2)", "(3)" and so on when the case, or the project for a slide without a case, already has it. Migration `0047` (slide ingest) made label uniqueness ignore deleted slides.
- The original leaves quarantine by `UploadPartCopy` in parts of `INGEST_COPY_PART_BYTES` (1 GiB), because R2 caps one copy at 4.995 GiB and slides reach 7 GB (https://developers.cloudflare.com/r2/platform/limits/). MinIO copies this way in the tests. R2 copies ranges too: a 1 GiB object in four ranges of 300 MiB took 56 s inside R2 on 2026-11-02, about 19 MB/s, with each part's ETag the MD5 of its range. A 7 GB slide would take about six minutes one part at a time. The quarantine object is deleted after publishing and after a refusal.
- A result file is marked in the upload metadata since RSET-004 (pairing results with slides), described below. A GeoJSON or CSV sent without `kind: "result"` is still checked as a slide and refused as `unknown`.

## Result files: pairing, waiting and import

RSET-004 (pairing results with slides) built this as [ADR 0125](../adr/0125-result-files-pair-in-python-and-import-as-their-own-job.md) (result files pair in Python and import as their own job) decided.

- The rules are `parfocal_common.pairing`, pure and tested in `packages/py-common/tests/test_pairing.py`. `POST /api/uploads/pairings` (`pairResultFiles`) runs them on the dropped paths, the slides among them and the slides already in the case, or in the project when no case is given. The browser sends the first 64 KiB of each result file as `head`, and `embedded_hint` reads a Parfocal JSON or GeoJSON `slide` block (`slide_id`, `file_name`) or a CSV column named `slide_id`, `slide`, `slide_name`, `image`, `image_id` or `file_name` from it. A slide already in Parfocal is answered as `{"path": null, "slide_id": ...}` and a dropped one as `{"path": ..., "slide_id": null}`.
- `createUpload` takes `kind: "result"` with `result_format`, `slide_id` or `slide_upload_id`, `pairing_rule` and `pairing_certainty`. A slide upload with any of them is a 422. A target without a rule is stored as `picked` and `sure`. `.json` is stored with no format and the worker sniffs `"format": "parfocal-results"`, while `.png` and `.tif` results are refused as `result-format-unknown` until RSET-005 (import checks and fixes). The slide upload must be the caller's own upload of a slide in the same project, or the answer is 404 `slide-upload-not-found`.
- A completed result upload whose slide is not ready has no job, which migration `0048` (result uploads) allows only for results. Three places queue the `result-import` job: `completeUpload` when the slide is ready, `publish_slide` for every waiting result of the slide upload it just published, in the same transaction, and `pairUploadWithSlide`. All three lock the slide upload's row before the result's row, and the publish step takes it `FOR UPDATE`, so a result that completes while its slide publishes is queued once and never missed. A plain `UPDATE ... WHERE slide_upload_id = ...` without that lock misses a row whose `slide_upload_id` was set by a transaction that committed after the update's snapshot.
- `getUploadStatus` answers `waiting` for a completed result with no job, with `needs-slide`, `waiting-for-slide` or `slide-refused` (its slide upload was aborted, expired or refused), and `ready` with `result_set_id` and the import notices `cell-probabilities-dropped` and `objects-skipped` once imported. A result that cannot be read ends `failed` with `result-unreadable`, `result-empty`, `result-columns-unmapped`, `result-too-many-classes` or `result-slide-missing`, whose messages live in `parfocal_common.result_imports`.
- `PUT /api/uploads/{upload_id}/slide` (`pairUploadWithSlide`) is for the uploader only, like the other upload routes. It is allowed while the result is uploading or waiting and answers 409 `result-import-started` once the job is queued, `result-already-imported` once the set exists and `result-import-ended` after a failed import, so an imported set never moves.
- The result set's id is `uuid5` of the upload id (`result_set_id_for`), so a rerun of the import writes the same keys. Its source file is kept at `t/{tenant}/s/{slide}/results/{set}/source{.ext}`, under the slide's prefix, so the retention purge deletes it with the slide.


## Import checks and choices

RSET-005 (import checks and fixes) made the import job check a result before it writes, as [ADR 0141](../adr/0141-result-imports-stop-for-choices-after-a-check.md) (result imports stop for choices after a check) decided.

- A file with problems leaves `uploads.import_problems` set and the job `done` with no set, and `getUploadStatus` answers `waiting` with `needs-choices`. `chooseHowToImport` queues a new job and replaces `uploads.job_id`. A second run never asks again, so choosing is "import the other N".
- Class mappings are remembered per project in `class_mappings` and applied on every later import, so a file whose new classes were all mapped before imports without asking.
- Objects without a class and missing scores only count as problems when other objects in the file have them, so a file with no scores at all is not flagged.
- The outside check needs the slide's `width` and `height`. Slides made in tests by SQL have none, so the check is skipped there.
- `leaveResultOut` sets the upload `aborted` and clears `job_id`, because the `completed_job` check allows a job only on a completed upload.
- The problem report CSV has the columns `upload`, `problem`, `place` and `message`, and the file is named `import-problems.csv`, never after the upload, since file names can hold PHI.

## Sorting a drop into cases

CASES-024 (sorting dropped files into cases) built this on top of the pairing above.

- The case rules are `parfocal_common.sorting`, pure and tested in `packages/py-common/tests/test_sorting.py`. The drop root is the folder every dropped file shares. A slide in a folder below it goes to the case named like its nearest folder, `folder`. Otherwise the nearest folder that looks like a case number, such as `S26-04812`, names the case, also `folder`. Otherwise a file name whose first part before `_` or a space looks like a case number names it, `file-name`. Otherwise the slide stays loose. A case number is letters, up to four digits, a dash and digits (`CASE_NUMBER`). `~` and folders longer than 100 characters are never cases. `cases: "loose"` keeps every slide loose.
- `sortDroppedFiles` answers each slide as `in-case`, `loose` or `left-out`, with its case label and `case_id` when the project already has that label, and `new_cases` for the labels it would create. A slide is a duplicate when the project has a slide with the same label (`label_of` of the file name) in the same case, or loose for a loose slide, and the sizes do not differ. A duplicate is left out, and its results pair with the slide already in the project by name. Results pair through `pair_results` with the kept dropped slides and every slide in the project.
- `slide_decisions` change a slide's case (`case`, rule `picked`), make it loose (`loose`) or keep or leave it out (`keep`). `result_decisions` set a result's slide by `slide_path` or `slide_id`, or with neither leave it unmatched. A decision for a path not in the drop is 400 `not-a-dropped-file`, and a result sent to a left-out or unknown dropped slide is 400 `not-a-dropped-slide`.
- `applyDroppedFiles` runs the same sorting, creates the missing cases with `source: upload` and a `case.created` audit event each, and answers the sorting with every `case_id` filled. It needs project owner rights when it creates a case. Everything happens in the request's transaction, so any refusal, including a result decision checked after the cases were inserted, leaves no case behind. Applying twice creates nothing the second time. Slide rows and result sets cannot exist at drop time ([ADR 0122](../adr/0122-ingest-publishes-the-slide-row-only-when-it-is-ready.md), the slide row appears only when ready), so the wizard then sends each kept slide to `createUpload` with its `case_id` and each paired result with its slide or slide upload, and the `result-import` job creates the result set. Replacing a duplicate while keeping its reviews, as the mock's duplicate scene offers, is not built.

## The upload engine in the web app

INGEST-002 (upload UI with resume) built `apps/web/src/upload`. `createUploadEngine` wraps one Uppy 6 instance with `@uppy/aws-s3` in Companion mode against `${apiBaseUrl}/uploads`, keeps the list of files as plain state for `useSyncExternalStore`, and is created once per endpoint and never destroyed. The drawer on `/projects/$projectId/cases/$caseId/upload` is `CaseUploadDrawer`. The window with steps is INGEST-021 (upload wizard with slides and results).

- Never call `uppy.destroy()` or remove the AwsS3 plugin while uploads are open. Uninstalling the plugin aborts every multipart upload in storage, which throws away what a reload could have resumed.
- `getChunkSize` runs before the create call, so the client cannot read `part_size` from the API. `apps/web/src/upload/part-size.ts` copies `partSizeFor`, and a different value makes the completion fail with 409 `upload-parts-invalid`.
- A file is added in one tick: ask `GET /uploads/open` first, then `addFile`, then `setFileState` with `{key, uploadId}` and `upload()`. Uppy's `upload()` starts every new file, so a file added before its open lookup finished would start as a fresh upload.
- After a reload the page cannot reopen a file. The engine keeps name, size, modified time and case of unfinished files in `sessionStorage` and shows them as "interrupted". Picking the same file again finds the open upload through the API and sends only the missing parts. File names can be PHI, so the hint lives in `sessionStorage`, which a closed tab clears.
- After an error the engine retries by itself after 2, 5 and 15 seconds, resets the count whenever bytes advance, and then shows Retry. The `online` event retries at once. Cancel on a file whose uploader gave up calls the abort route itself, because Uppy removes the uploader's listeners on error.
- The generated fake API handlers match `*/api/uploads/*` on every origin, so a test that wants the real routes must put them under another path. The web E2E sets `PARFOCAL_PUBLIC_API_BASE_URL` to `http://127.0.0.1:9161/e2e`, where `@parfocal/upload-spike/harness` serves the Companion routes over MinIO.
- `PARFOCAL_UPLOAD_E2E=1 PARFOCAL_E2E_PORT=<free port> CI=1 pnpm --filter @parfocal/web exec playwright test e2e/upload-resume.spec.ts` runs the 1 GiB test. It needs Docker with the pinned MinIO image and writes 1 GiB to the temp folder. Numbers are in the [result file](../results/2026-11-02-upload-ui-resume.md).

## Bulk import from a folder

INGEST-020 (bulk import tool for pilot onboarding) added `parfocal_api.bulk_import`, a command that sends a folder of slides through the same routes as the browser. Run it as `PARFOCAL_API_TOKEN=pf_... uv run --package parfocal-api python -m parfocal_api.bulk_import FOLDER --project PROJECT_ID --api https://api.example` with a service account token that owns the project.

- The manifest is `manifest.csv` in the folder unless `--manifest` names another. It needs the columns `file`, a path inside the folder, and `case`, and takes the patient columns of the case CSV import (`patient_name`, `mrn`, `birth_date`, `sex`, `age_years`). Any other column, a missing file, a path outside the folder, a file listed twice, an empty case or `~` stops the run before anything is sent.
- Cases come from `importCases` with the manifest minus its `file` column, checked as a dry run first, so the case import's own problems also stop the run and existing cases are reused. No slide rows are imported, because ingest always creates its own row and would number the file "(2)" next to an empty one. `--dry-run` stops after that check.
- Each file goes through `findOpenUpload`, `createUpload` with its `case_id`, one signed part `PUT` at a time and `completeUpload`. An open upload of the same name, size, modified time and case is resumed with only its missing parts. A file whose label is already in its case is reported `already-in-case` and skipped, so running the same manifest again sends nothing new.
- Part `PUT`s go to storage through a second client without the token, and a failed part is tried 4 times. `--wait SECONDS` polls `getUploadStatus` until every file is ready, failed or waiting. The exit code is 1 when any row or file failed.
- `apps/api/tests/test_bulk_import.py` imports 20 copies of `synthetic-jpeg.tiff` into 5 cases against the local database and MinIO, runs the ingest worker and checks every slide is published in its case.
