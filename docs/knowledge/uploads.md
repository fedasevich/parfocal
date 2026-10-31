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
