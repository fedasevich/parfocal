# 0116. Resumable uploads with S3 multipart, Uppy and part URLs signed by the API

- Date: 2026-10-31
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-039 (resumable upload protocol). Edits INGEST-001 (upload API with presigned multipart), INGEST-002 (upload UI with resume) and adds INGEST-028 (upload protocol check on the R2 dev bucket). Feeds INGEST-000 (research check for upload and server readers)

## Context

Slides reach 7 GB (`Hamamatsu-1.ndpi`) and NDPI files above 4 GB are in scope. Uploads come from hospital and lab networks that drop, and from tabs that get closed. [ADR 0003](0003-pilot-platform-architecture.md) (pilot platform architecture) puts slides in Cloudflare R2, the API in FastAPI on Modal and nothing on an always-on server, and its default for this slot is S3 multipart with presigned parts through Uppy, so that slide bytes never pass through the API. The task asks for a spike that uploads a 4 GB NDPI over a throttled link with a forced disconnect and resumes without restarting.

R2 facts that shape the protocol, from the Cloudflare docs on 2026-10-31:

| Fact | Source |
|---|---|
| Every part except the last must have the same size, or CompleteMultipartUpload fails with error 10048 (`InvalidPart`) | https://developers.cloudflare.com/r2/objects/upload-objects/ and https://developers.cloudflare.com/r2/api/error-codes/ |
| Parts are 5 MiB to 5 GiB, at most 10,000 parts, objects up to 4.995 TiB | https://developers.cloudflare.com/r2/platform/limits/ |
| Presigned URLs support GET, HEAD, PUT and DELETE only, so CreateMultipartUpload and CompleteMultipartUpload, which are POSTs, cannot be presigned | https://developers.cloudflare.com/r2/api/s3/presigned-urls/ |
| Presigned URLs live from 1 second to 7 days and work only on the S3 API domain | the same page |
| An expired presigned URL answers 403 `ExpiredRequest` without CORS headers, so browser code cannot read the error and sees a network failure | https://developers.cloudflare.com/r2/buckets/cors/ |
| Incomplete multipart uploads are aborted after 7 days by default, and a lifecycle rule with `AbortIncompleteMultipartUpload` can shorten that per prefix | https://developers.cloudflare.com/r2/buckets/object-lifecycles/ |
| A part's ETag is the MD5 of its bytes, and the object's ETag is the MD5 of the concatenated part MD5s followed by `-` and the part count | https://developers.cloudflare.com/r2/objects/upload-objects/ |

## Options considered

1. tus, with tusd (Go) or tus-py as the server. The protocol is open and mature, Uppy has a tus plugin, and resume works at any byte offset through a `HEAD` that returns the offset, so no part sizes exist. But every byte goes through the tus server. tusd must run somewhere always on, which ADR 0003 (pilot platform architecture) rules out for one person, or tus-py runs on Modal, which bills container time for the whole transfer, puts a multi-gigabyte request through a serverless endpoint and still writes to R2 with multipart underneath. The bytes cross the network twice.
2. S3 multipart with presigned part URLs and Uppy's AWS S3 plugin. The browser sends parts straight to R2, and the API only creates, signs, lists, completes and aborts, which are small requests. Resume reads the stored parts from R2 with ListParts, so the server holds the truth and the browser keeps no byte state. Failed parts are retried alone. It is the default of ADR 0003 (pilot platform architecture) and needs no new service. The costs are R2's rules: one part size for the whole upload, POSTs that cannot be presigned, a CORS policy on the bucket, part URLs that are bearer tokens until they expire, and incomplete uploads that hold storage until they are aborted. Uppy 6 sends one file's parts one at a time, so every part pays a round trip.
3. Google-style resumable uploads, a session URL that takes `PUT` with `Content-Range` and answers an empty `PUT` with the stored offset. The protocol is the simplest of the three and resumes at a byte offset. Only Google Cloud Storage and other Google services speak it. R2 does not, so it means either our own server that receives every byte, with the same problem as tus, or moving storage to Google Cloud against ADR 0003 (pilot platform architecture).

Every option shares one limit. A browser cannot reopen a file by itself after a reload, so the user picks the file again and the app matches it to the open upload.

## Decision

Option 2, S3 multipart with presigned part URLs, with Uppy 6 in Companion mode against routes the API implements. The spike proved it on a 4 GiB file and on the 1.99 GB `OS-1.ndpi` over a throttled link that was cut and over a page that was closed, and in every case no stored part was sent again and the object's SHA-256 equalled the source ([result](../results/2026-10-31-resumable-upload-spike.md)). Tus and Google-style uploads both need a server in the byte path, which ADR 0003 (pilot platform architecture) avoids.

### How it works

| Concern | Rule |
|---|---|
| Who talks to R2 | The browser only sends `PUT` requests for parts to presigned URLs. The API creates, lists, completes and aborts with its own credentials, because R2 cannot presign the POSTs, and because the API must check the tenant and record the upload |
| Client | `@uppy/core` and `@uppy/aws-s3` 6 with `companionEndpoint` set to the API's upload routes and `shouldUseMultipart: true`. The `signRequest` mode is not used, because it presigns the POSTs and its ListParts reads only the first page |
| API routes | Uppy's Companion S3 contract, five routes under the API: create (`POST /s3/multipart`), sign one part (`GET /s3/multipart/{uploadId}/{partNumber}?key=`), list parts (`GET /s3/multipart/{uploadId}?key=`), complete (`POST /s3/multipart/{uploadId}/complete?key=`) and abort (`DELETE /s3/multipart/{uploadId}?key=`). Each route checks that the upload ID and key belong to the caller's workspace, so a key in the URL never decides anything alone |
| Key | Chosen by the API, `t/{tenant}/quarantine/{upload}/{safe name}`, never by the client |
| Part size | 16 MiB, grown to the smallest whole MiB that keeps the file within 10,000 parts, so every file up to 156.25 GiB uses 16 MiB. The API picks it at create from the declared size, stores it with the upload and returns it, and the client's `getChunkSize` returns exactly that value. A 7 GB slide is 418 parts. The rule is `partSizeFor` in `packages/upload-spike/src/part-size.ts` |
| Equal parts | Before CompleteMultipartUpload the API lists every part with pagination and refuses the completion unless the part numbers run from 1 without gaps, every part but the last has the stored part size, the last has the rest, and each ETag matches what the client reports. MinIO accepted uneven parts in the spike, so only this check catches them before R2 does |
| Part URLs | Signed one part at a time just before that part is sent, valid for 15 minutes, which covers a 16 MiB part down to about 0.15 Mbit/s. A long upload never outlives its URLs, because each URL is used within seconds of being signed |
| Expired or failed part | Uppy retries a failed part `PUT` 3 times, after 150, 300 and 600 ms, aborts a part that makes no progress for 30 s, and then reports an error. Its calls to the API routes are not retried. Retrying the file lists the stored parts again through the API and signs fresh URLs, which also covers R2's expired URL that looks like a network error |
| Resume in the same page | After the link returns, the app retries the file. Uppy lists the stored parts and sends only the missing ones. The part that was in flight is lost and sent again whole |
| Resume after a reload | The upload record in Postgres is the state. The user picks the file again, the app asks the API for the caller's open upload with the same name, size and last-modified time, sets Uppy's `s3Multipart` file state to its key and upload ID, and starts. Uppy lists the stored parts and sends only the missing ones. Uppy's Golden Retriever plugin is optional and cannot keep a multi-gigabyte file anyway |
| Cleanup | The API aborts an upload when the user cancels. A job aborts uploads with no new part for 24 hours and marks their records. An R2 lifecycle rule on the quarantine prefix aborts incomplete uploads after 1 day as the backstop, shorter than R2's 7-day default |
| CORS on each bucket | `AllowedOrigins` the app origin of that environment, `AllowedMethods` `["PUT"]`, `AllowedHeaders` `["Content-Type"]`, `ExposeHeaders` `["ETag"]` so Uppy can read each part's ETag, `MaxAgeSeconds` 3600. Set in `infra/tofu` |
| Checksums | Each part's ETag is the MD5 of its bytes on R2 and on MinIO, and the API keeps the listed ETags. The ingest worker computes the SHA-256 of the whole file when it copies it to its own disk ([ADR 0043](0043-server-slide-reading.md) (server slide reading) rule 8), and that is the integrity value of record. The browser does not hash the file in v1 |

### Follow-ups

- INGEST-028 (upload protocol check on the R2 dev bucket) repeats the protocol checks against `parfocal-dev` before INGEST-001 (upload API with presigned multipart) is ticked: presigned part `PUT` with the CORS policy above and the ETag readable, R2 refusing uneven parts with error 10048, a presigned POST being refused, an expired URL answering 403 without CORS headers, ListParts pagination, the `AbortIncompleteMultipartUpload` rule being accepted and whether parts accept `x-amz-checksum-sha256`. The CORS change goes through `infra/tofu`, and its `tofu apply` needs the owner's yes under [ADR 0115](0115-production-access-and-spend-caps.md) (production access and spend caps).
- TODO: Uppy sends one part at a time per file, and every part pays a signature, a CORS preflight for its new URL and the `PUT`. In the spike that used 77 to 80% of a 200 Mbit/s link at a 50 ms round trip, against 91 to 97% with no added round trip. If INGEST-002 (upload UI with resume) measures uploads of single large slides as too slow on real links, the options are a larger part, parallel parts within a file through a fork of the plugin, or a small client of our own on the same routes, and each is a new ADR.
- TODO: Uppy 6 removed `retryDelays`. Whether the app should retry the file by itself after an error, with a back-off, or show a retry button belongs to INGEST-002 (upload UI with resume) and INGEST-021 (upload wizard with slides and results).

## Consequences

- INGEST-001 (upload API with presigned multipart) now names the five routes, the key rule, the part size rule, the check before completion, the open upload lookup for resume, the stale upload job and the lifecycle rule, and refers to this record.
- INGEST-002 (upload UI with resume) uses Uppy in Companion mode and the latency proxy's new uplink limit for its throttled E2E test.
- `@parfocal/latency-proxy` gained an uplink limit and an uploaded byte count, because it only throttled downloads before.
- `packages/upload-spike` keeps the spike runnable at any size. It needs Docker and pulls a community build of MinIO, because the official MinIO images are no longer published ([knowledge/uploads.md](../knowledge/uploads.md)).
- The upload section of the [threat model](../security/threat-model.md) still says to revisit it once STACK-039 (resumable upload protocol) is decided. Threat U1 (completing or overwriting another tenant's upload) is met by the per-route ownership check and the server-chosen key, and INGEST-001 (upload API with presigned multipart) tests it.
- If R2 behaves differently from the docs in INGEST-028 (upload protocol check on the R2 dev bucket), this record is revised before INGEST-001 (upload API with presigned multipart) is built.
