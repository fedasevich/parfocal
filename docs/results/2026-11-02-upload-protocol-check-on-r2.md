# Result: the upload protocol holds on R2 at 1 GiB, and two R2 doc facts were wrong

- Date: 2026-11-02
- Backlog: INGEST-028 (upload protocol check on the R2 dev bucket)
- Kind: check against a real cloud service
- Commit: `9e07d57` for the R2 run, and `7d29d5a` for a fix after it that requires a second ListParts page only when the parts exceed one page, rerun green against MinIO at 256 MiB. The code is `packages/upload-spike` (`--target r2`) and the https forwarding in `packages/latency-proxy`
- Environment: Apple M4, macOS 15.8.1, Node 26.13.0, Playwright 1.64.0 with headless Chromium, Uppy 6.0.5, `@aws-sdk/client-s3` 3.1160.0 with `requestChecksumCalculation` and `responseChecksumValidation` set to `WHEN_REQUIRED`. R2 bucket `parfocal-dev` (location `eeur`) over the owner's home connection in Europe, through the token "parfocal-dev local" (object read and write on `parfocal-dev` only). The bucket CORS and lifecycle rules came from `infra/tofu` and were applied to `parfocal-dev` alone by the lead at the owner's yes earlier on 2026-11-02
- Data: a 1 GiB file of random bytes written to the system temp folder and deleted afterwards. No PHI

## Question

The STACK-039 (resumable upload protocol) spike ran against MinIO, which differs from R2 where it matters. Does the protocol of [ADR 0116](../adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md) (resumable uploads with S3 multipart and Uppy) work on R2, and are the R2 facts it rests on true? The task names eight checks: a part `PUT` from the dev app origin under the CORS rule with the ETag readable, uneven parts refused with error 10048, a presigned POST refused, an expired part URL answering 403 without CORS headers, ListParts over more than one page, the `AbortIncompleteMultipartUpload` lifecycle rule accepted, whether parts accept `x-amz-checksum-sha256`, and `UploadPartCopy` with `x-amz-copy-source-range` as the ingest job of INGEST-017 (publish step and slide status) uses it.

## Method

`pnpm --filter @parfocal/upload-spike spike -- --target r2`, run once at the defaults: 1 GiB, 16 MiB parts (64), 25 parts per ListParts page, part URLs valid 300 s, 300 MiB copy ranges, no added RTT and no uplink limit. The run is the STACK-039 spike with these changes.

1. Every key sits under a fresh prefix `t/spike-{8 hex}/`, inside the lifecycle rule's `t/`. The script refuses any bucket but `parfocal-dev`.
2. The page is served at `http://localhost:5173`, the dev origin in the bucket CORS rule, by the app proxy listening on that port. A first attempt served it through Playwright route interception, but Chromium then treated the page as public and refused the loopback storage proxy, and Playwright answers CORS preflights itself while interception is on, so R2's own preflight answer never reached the browser.
3. Part `PUT` requests go from Chromium through `@parfocal/latency-proxy`, which now forwards to an https target, to R2. The proxy adds nothing and is there so that the link can be cut. Each part URL is signed for R2's host and its origin swapped to the proxy, which rewrites `Host` back.
4. The upload is cut at 30% of the file, the link stays down 5 s, Uppy retries, and the page is closed at 60% and opened again, as in the spike.
5. After completion the script reads the object back once for its SHA-256 and runs the protocol checks with the object token: uneven parts completed directly, a presigned `POST ?uploads` sent with `fetch`, a 2 s part URL used after 3.5 s, preflights from the app origin and from `http://evil.example`, a part `PUT` from the app origin, one 5 MiB part with a correct and one with a wrong `x-amz-checksum-sha256` on an upload created without and one created with `ChecksumAlgorithm` SHA256, and a ranged copy of the 1 GiB object in four ranges to a new key.
6. The object token cannot read bucket settings (`GetBucketCors` and `GetBucketLifecycleConfiguration` answered `AccessDenied`), so the CORS and lifecycle rules are read through the Cloudflare API with the `parfocal-tofu` token. The run writes no bucket setting.
7. It then aborts every open upload and deletes every object under the prefix, lists both again and fails unless both are empty. The same cleanup runs after a failure.
8. Every storage request is counted: SDK operations by a middleware at the deserialize step, so presigning is not counted, browser requests by method at the proxy, and the script's own `fetch` calls.

## Results

### Upload with a cut link and a closed page

| Phase | Duration (s) | Bytes through the proxy | Parts listed at start | Parts signed | First part signed | Listed parts signed again | Bytes resent | Throughput (MB/s) |
|---|---|---|---|---|---|---|---|---|
| First run until the cut | 29.0 | 323,469,260 | 0 | 20 | 1 | 0 | 4,702,156 | 11.2 |
| After the link returns, until the page closes | 24.7 | 329,382,590 | 19 | 20 | 20 | 0 | 10,615,486 | 13.4 |
| After the page opens again | 33.0 | 436,207,616 | 38 | 26 | 39 | 0 | 0 | 13.4 |

- The whole upload took 92.0 s, including the 5 s outage. Uppy reported the cut as an upload error after 1.12 s. The retried file listed the stored parts 93 ms after the retry and signed its first part 96 ms after. The reopened page listed after 388 ms.
- 1,089,059,466 bytes passed the proxy for a 1,073,741,824 byte file, 15,317,642 bytes more, which is the part in flight at each interruption and less than one part each time. No part listed as stored was signed again.
- 64 parts were stored, every one but the last 16,777,216 bytes, and every part ETag equalled the MD5 of its source part. The object was 1,073,741,824 bytes with ETag `2d7ceb5e100af0174ca65c5217779cb3-64`, the multipart ETag of the source, and its SHA-256 equalled the source (`685d55b6...`).
- ListParts with 25 per page read 1, 2, 3 and 1 pages as the stored parts grew, so pagination works with `MaxParts` and `PartNumberMarker`.

### Protocol checks

| Check | R2 answered | ADR 0116 said |
|---|---|---|
| Preflight from `http://localhost:5173` | 204, `Access-Control-Allow-Origin: http://localhost:5173`, `Access-Control-Allow-Methods: PUT` | As expected |
| Preflight from another origin | 403, no CORS headers | As expected |
| Part `PUT` from the app origin | 200, `Access-Control-Expose-Headers: ETag`, ETag present. Chromium sent 66 real preflights for 66 part `PUT`s and Uppy read every ETag | As expected |
| Completing 16 MiB, 15 MiB and 9 MiB + 3 B parts | Refused, `InvalidPart`, "All non-trailing parts must have the same length." The S3 answer has no number 10048. The upload API stand-in refused the same parts first with 400 | Confirmed, but the code to match is `InvalidPart` |
| Presigned `POST ?uploads` (CreateMultipartUpload) | 200 with an `UploadId`, an upload was created | Wrong. The docs say R2 presigns GET, HEAD, PUT and DELETE only |
| Part URL used 1.5 s after it expired | 403 `ExpiredRequest`, no `Access-Control-Allow-Origin`. A fresh URL for the same part answered 200 with CORS headers | Confirmed |
| `AbortIncompleteMultipartUpload` lifecycle rule | Reads back as `abort-incomplete-uploads`, enabled, prefix `t/`, `Age` 86400 s | Confirmed |
| CORS rule | Reads back as `browser-part-uploads`: origin `http://localhost:5173`, method `PUT`, header `Content-Type`, exposes `ETag`, 3600 s | Confirmed |
| `x-amz-checksum-sha256` on a part | `NotImplemented` ("Header 'x-amz-checksum-sha256' ... not implemented") for the correct and for the wrong value, on an upload created with and without `ChecksumAlgorithm` SHA256. ListParts showed no checksum | Open before. Answer: no |
| `UploadPartCopy` with `x-amz-copy-source-range` | 4 ranges of 300 MiB, the last 124 MiB, copied in 56.3 s. Every copied part's ETag equalled the MD5 of its source range, the object was 1,073,741,824 bytes and its ETag the multipart ETag of those ranges | Unverified before. Works |
| Signing a part for a key the upload does not own | The stand-in answered 403 before storage was touched | As in the spike |
| Aborting through the API | 1 open upload before, 0 after | As in the spike |

### Operations and cost

R2 bills Class A and Class B operations, and DeleteObject and AbortMultipartUpload are free (https://developers.cloudflare.com/r2/pricing/). Whether a CORS preflight is billed is not on that page, so the preflights are listed apart.

| Source | Class A | Class B | Free | Preflights |
|---|---|---|---|---|
| Browser part uploads | 66 `PUT` | | | 66 |
| Script SDK calls | 9 CreateMultipartUpload, 11 ListParts, 3 CompleteMultipartUpload, 4 ListMultipartUploads, 4 UploadPart, 4 UploadPartCopy, 2 ListObjectsV2 | 2 HeadObject, 1 GetObject | 8 AbortMultipartUpload, 2 DeleteObject | |
| Script `fetch` calls | 7 part `PUT`, 1 presigned `POST` | | | 2 |
| The 1 GiB run | 111 | 3 | 10 | 68 |

- Before the 1 GiB run, four short runs found the two problems in the method and checked the fixes: one 1 GiB run stopped after 3.5 minutes with no part stored (the page could not reach the proxy), and three runs at 48 MiB. Two one-off probes read the token's reach and the clock skew (none). Together they made fewer than 300 Class A and 20 Class B operations. Every run deleted its prefix, and the last list of each showed nothing left.
- Storage peaked at about 2.1 GiB (the object, its copy and open parts) for under three minutes per run.
- All of it sits far inside the monthly free tier of 1 million Class A and 10 million Class B operations and 10 GB-months of storage, so the cost is $0. Reading the bucket settings through the Cloudflare API is not billed.

## Interpretation

- The protocol of ADR 0116 (resumable uploads with S3 multipart and Uppy) works on R2 as it did on MinIO: part `PUT`s from the dev origin pass CORS with the ETag readable, an interrupted upload resumes from ListParts without sending a stored part again, and the result is byte for byte the source.
- R2 refuses uneven parts at completion, as the docs say, with the S3 code `InvalidPart`. The API's own check before completion stays, because MinIO in the tests would accept them. `InvalidPart` is already among the refusals `parfocal_api.uploads` maps to 409 `upload-parts-invalid`.
- R2 presigned a CreateMultipartUpload POST although its docs say it cannot. Nothing in the protocol depends on that. The API still creates and completes uploads itself, because it must check the tenant, choose the key, record the upload and check the part sizes. The ADR's fact row now says so.
- R2 does not take SHA-256 checksums on parts, so integrity rests on the part MD5 ETags checked at completion and on the SHA-256 the ingest worker computes, as ADR 0116 already decided. No client may send `x-amz-checksum-*` headers to R2. Newer AWS SDKs add CRC32 values by default, which is why the script sets `WHEN_REQUIRED`. The Python client in `parfocal_common.object_store` signs by hand and sends none.
- Ranged `UploadPartCopy` works on R2 and keeps MD5 ETags per range, so the ingest job's move out of quarantine works as built. It ran at about 19 MB/s inside R2 here, so moving a 7 GB slide in 1 GiB parts would take about six minutes one part at a time. Measure it with the ingest job before deciding whether to copy parts in parallel.
- An expired part URL looks like a network error in the browser, as the docs say. Signing each part just before use and retrying the file, which lists and signs again, covers it.

## Follow-ups

- ADR 0116 (resumable uploads with S3 multipart and Uppy) revised: its fact table gained a column with what R2 did, its "Who talks to R2" rule no longer gives "R2 cannot presign POSTs" as a reason, and its checksum rule says R2 refuses part checksums.
- The CORS and lifecycle rules are applied only to `parfocal-dev`. Staging and production get them with their own `tofu apply`, which needs the owner's yes.
- TODO: time a 7 GB ranged copy in the ingest job of INGEST-017 (publish step and slide status) on R2 and decide on parallel part copies if it is too slow.
