# Uploads

How large slide uploads reach storage, and what the STACK-039 (resumable upload protocol) spike found. The protocol is in [ADR 0116](../adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md) (resumable uploads with S3 multipart and Uppy) and the numbers are in the [result file](../results/2026-10-31-resumable-upload-spike.md). Entries marked "unverified" come from vendor docs and wait for INGEST-028 (upload protocol check on the R2 dev bucket).

## R2 cannot presign POST, so the API creates and completes uploads

R2 presigns GET, HEAD, PUT and DELETE only. CreateMultipartUpload and CompleteMultipartUpload are POSTs, so Uppy's `signRequest` mode, which presigns every request, does not fit R2. Use Uppy's Companion mode instead: the browser sends only part `PUT` requests to R2, and the API creates, lists, completes and aborts with its own credentials. Unverified. Source: https://developers.cloudflare.com/r2/api/s3/presigned-urls/ and ADR 0116 (resumable uploads with S3 multipart and Uppy).

## R2 refuses uneven parts and MinIO does not

R2 requires every part except the last to have the same size and fails the completion with error 10048 otherwise (unverified). MinIO completed an upload of 16 MiB, 15 MiB and 9 MiB parts without complaint in the spike. A local test against MinIO therefore proves nothing about part sizes, and the API must check the listed part sizes against the stored part size before it completes. `partsProblem` in `packages/upload-spike/src/part-size.ts` is that check.

## An expired R2 URL looks like a network error in the browser

R2 answers an expired presigned URL with 403 `ExpiredRequest` and no CORS headers, so the browser cannot read the status (unverified). MinIO's 403 for an expired URL carried CORS headers in the spike, so a local test cannot reproduce this. Sign part URLs one at a time just before use, and treat a failed part as "list the stored parts and sign again", which Uppy already does when a file is retried.

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

- `uploadId` is our upload record's UUID, not the storage upload ID. The storage ID stays in `uploads.storage_upload_id` and only appears inside signed part URLs. Field names that Uppy reads (`uploadId`, `PartNumber`, `Size`, `ETag`, `location`, `url`) keep Uppy's spelling, the rest are snake case.
- Every route except create loads the record under the workspace's row-level security, by the creator (person or service account), and compares the `key` with the stored key. Anything else is 404 `upload-not-found`, before storage is touched, so another workspace's ids never reach R2. The caller must still hold `upload-slides` as a project owner, which `require_uploading` from the result set routes checks, so a demoted owner stops mid-upload and an archived project answers 409 `project-archived`.
- The completion check is `parts_problem` in `parfocal_common.part_plan`: parts run from 1 without gaps, every part but the last has the stored part size, the last has the rest, and the ETags sent equal the ETags stored. A refusal is 409 `upload-parts-invalid` with a detail made only of numbers, and the upload stays open so the client can send the right part and complete again. A storage refusal at completion (`InvalidPart`, `InvalidPartOrder`, `EntityTooSmall`) is the same problem, and since the job is queued in the same transaction, it is rolled back too.
- Completing twice answers the first result again. Aborting twice answers `aborted` again. Signing or listing a finished upload is 409 `upload-not-open`, and an upload that storage no longer knows is 409 `upload-gone`.
- The largest upload is `UPLOAD_MAX_BYTES`, 20 GiB by default, which is about three times the largest fixture (7 GB) and 1,280 parts at 16 MiB. Larger is 400 `upload-too-large`. With a limit below 156.25 GiB the 16 MiB part never grows, but the growth rule is unit-tested.
- File names can hold patient names, so `uploads.file_name` and `uploads.object_key` are classed `phi`, the job input holds only the upload ID, and the audit entries (`upload.completed`, `upload.aborted`, `upload.expired`) hold ids and sizes only. The key carries a cleaned file name, as ADR 0116 decided, so it also travels in the `?key=` query of the Companion routes and in R2 request paths. Request logs keep only the route template, never the query.
- The key is `t/{tenant}/quarantine/{upload}/{name}` with the name cut to `[A-Za-z0-9._-]`, folders dropped and 120 characters kept with the extension.

## The stale upload job and the lifecycle rule

The API never sees a part `PUT`, so "no new part for 24 hours" is measured by `uploads.last_activity_at`, which create, sign and list set. A part URL lives 15 minutes, so no part can arrive more than 15 minutes after the last signature. `parfocal_api.stale_uploads.abort_stale_uploads` walks every workspace, aborts open uploads idle for 24 hours in storage, marks them `expired` and audits it. `python -m parfocal_api.stale_uploads` runs it once. TODO: schedule it hourly with the cloud cron, like the retention purge.

The R2 lifecycle rule in `infra/tofu/cloudflare.tf` aborts incomplete multipart uploads after 1 day on the prefix `t/`, not on the quarantine prefix. A lifecycle prefix cannot skip the tenant in `t/{tenant}/quarantine/`, and every multipart upload in the bucket is an upload in progress anyway, so the wider prefix does the same job. The bucket CORS rule of ADR 0116 is in the same file. Neither is applied: that is INGEST-028 (upload protocol check on the R2 dev bucket) and needs the owner's yes.

## Local storage is MinIO in compose

`compose.yaml` has a `storage` service with the same pinned MinIO build as the spike, on port 9000, user `parfocal` and password `parfocal-local-secret`, which are the defaults of the `STORAGE_*` settings. The password is written as the default of `${PARFOCAL_LOCAL_MINIO_PASSWORD:-...}`, because the secret scan in the pre-commit hook and the `lint` job flags a plain `MINIO_ROOT_PASSWORD` value even at low confidence. The `db` CI job starts it with the rest of the stack. The database tests create the `parfocal-test` bucket themselves, and `PARFOCAL_TEST_STORAGE_URL` points them at another MinIO, as a parallel session must when the shared stack is already running without it. A local stack started before INGEST-001 needs `pnpm db:up` once more to add MinIO, or every upload, permission and isolation test fails to connect.
