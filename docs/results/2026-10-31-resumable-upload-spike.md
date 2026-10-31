# Result: a 4 GiB upload with Uppy resumes after a cut link and a closed page and never sends a stored part again

- Date: 2026-10-31
- Backlog: STACK-039 (resumable upload protocol)
- Kind: spike
- Commit: `1cea361` for the four upload runs, `fbc5932` for the run that counts storage requests. The code is `packages/upload-spike` and the uplink limit in `packages/latency-proxy`
- Environment: Apple M4 with 24 GB of memory, macOS 15.8.1, Node 26.13.0, Playwright 1.64.0 with headless Chromium 156.0.8078.4, Docker Desktop with engine 29.5.2 (10 CPUs and 11.7 GiB for the VM), MinIO `RELEASE.2026-08-04T00-00-00Z` from `pgsty/minio@sha256:b6bfe7239bfc83fb90d31612d9704d86039dd714f7904b3f1ad68f211e602372`, Uppy 6.0.5 (`@uppy/core` 6.3.0, `@uppy/aws-s3` 6.3.0), `@aws-sdk/client-s3` 3.1160.0. Everything ran on one machine over loopback, with the network shaped by `@parfocal/latency-proxy`
- Data: a 4 GiB file of random bytes, a 1 GiB file of random bytes and the real `OS-1.ndpi` (1,992,269,307 bytes, a Hamamatsu NDPI from the fixture cache). No 4 GB NDPI fixture exists, so the 4 GiB run uses a synthetic file. The protocol never reads the file's content, so a synthetic file tests the same thing, and the NDPI run shows a real slide behaves the same way. No PHI

## Question

Can a browser upload a 4 GB file to an S3-compatible store over a throttled connection, lose the connection mid-upload, and resume without sending the stored parts again, as STACK-039 (resumable upload protocol) asks? And what do the R2 constraints in [ADR 0116](../adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md) (resumable uploads with S3 multipart and Uppy) look like against a local server: equal part sizes, part URL expiry, ListParts pagination, aborting, lifecycle rules, CORS with `ETag` and checksums? No budget or POC number exists. The POC had no resumable upload.

## Method

`pnpm --filter @parfocal/upload-spike spike` with the flags below. One run does this.

1. Starts MinIO in Docker with `--rm`, its CORS origin set to the app origin, and creates a bucket.
2. Writes the synthetic file with `crypto.randomFillSync` in the system temp folder, outside the repository, or takes `--source`. Reads it once for its SHA-256 and the MD5 of every 16 MiB part.
3. Starts the upload API stand-in (`src/upload-api.ts`), which speaks Uppy's Companion S3 contract, picks the key under `t/spike-tenant/quarantine/` and the part size, signs one part URL at a time for 300 s, lists parts 100 per page and refuses a completion whose parts are not all one size.
4. Starts two latency proxies with the same RTT, one in front of the API and the page and one in front of MinIO with the uplink limit. Part URLs are signed for MinIO's address and their origin is swapped to the second proxy, so every part `PUT` is cross-origin and passes CORS.
5. Opens the page in headless Chromium, picks the file with `setInputFiles` and starts Uppy with `companionEndpoint`, `shouldUseMultipart: true` and `getChunkSize` returning 16 MiB.
6. When 30% of the file has passed the storage proxy, closes both proxies, which destroys every socket. Waits for Uppy's `upload-error`, keeps the link down for 5 s in total, lists the stored parts directly, starts new proxies on the same ports and calls `uppy.retryAll()`.
7. When 60% of the file is stored, closes the page, waits 1 s, opens a new page, picks the file again, asks the API for the open upload with that name and size, sets Uppy's `s3Multipart` state to its key and upload ID and starts.
8. After completion, reads the object back from MinIO directly, not through a proxy, and compares its SHA-256 with the source, its ETag with the MD5 of the concatenated part MD5s, and every stored part's ETag with the MD5 of the source part.
9. Runs the protocol checks on separate keys: uneven parts, a part URL for another key, a 2 s part URL used after 3.5 s, an abort, CORS preflights and two lifecycle rules.
10. Stops the container, which removes it and its volume, and deletes the synthetic file.

Each upload is split into three phases: until the cut, from the retry until the page closes, and from the new page until done. "Bytes through the proxy" counts request body bytes the storage proxy forwarded to MinIO. "Resent bytes" in a phase is those bytes minus the bytes of the parts that phase added to storage, so it is the part that was in flight when the phase ended and was lost. "Throughput" is a phase's bytes through the proxy divided by its time after the first part URL was signed. "Resume to list" and "resume to first part" run from the retry call or the new page's `goto` to the API's ListParts call and its first part signature.

| Run | File | Bytes | RTT | Uplink | Commit |
|---|---|---|---|---|---|
| A | synthetic | 4,294,967,296 | 50 ms | 200 Mbit/s (25,000,000 B/s) | `1cea361` |
| B | `OS-1.ndpi` | 1,992,269,307 | 50 ms | 200 Mbit/s | `1cea361` |
| C | synthetic | 1,073,741,824 | 0 ms | 200 Mbit/s | `1cea361` |
| D | synthetic | 1,073,741,824 | 150 ms | 50 Mbit/s (6,250,000 B/s) | `1cea361` |
| E | synthetic | 268,435,456 | 50 ms | 200 Mbit/s | `fbc5932` |

All runs used 16 MiB parts, a cut at 30%, a 5 s outage, a page close at 60%, 300 s part URLs and 100 parts per ListParts page.

## Results

### Every run

| Run | Parts | Last part | Wall time | Bytes through the proxy | Bytes beyond the file | SHA-256 equal | Object ETag equal | Part ETags equal source MD5 | Parts other than the last all 16 MiB |
|---|---|---|---|---|---|---|---|---|---|
| A | 256 | 16,777,216 | 224.97 s | 4,324,442,112 | 29,474,816 | yes | yes | yes | yes |
| B | 119 | 12,557,819 | 108.28 s | 2,011,635,195 | 19,365,888 | yes | yes | yes | yes |
| C | 64 | 16,777,216 | 51.26 s | 1,086,439,424 | 12,697,600 | yes | yes | yes | yes |
| D | 64 | 16,777,216 | 212.52 s | 1,086,046,208 | 12,304,384 | yes | yes | yes | yes |
| E | 16 | 16,777,216 | 21.58 s | 296,124,416 | 27,688,960 | yes | yes | yes | yes |

SHA-256 of run A's source and object: `38ea46d961b97a2669538f60e9b48cf4f4690780413fc3ec73a3695ba7a02350`. Run B's: `5c78bb466a47c7242e6256ccdd14a8a0ced66088cf39b91d33622990afffed1e`, the same as the fixture cache records for `OS-1.ndpi`. Run A's object ETag: `0a19d7f4dd662af0bc053340d10681eb-256`.

### Phases

| Run | Phase | Parts stored at start | First part signed | Parts signed | Stored parts signed again | Bytes through the proxy | Resent bytes | Resume to list | Resume to first part | Throughput |
|---|---|---|---|---|---|---|---|---|---|---|
| A | until the cut | 0 | 1 | 77 | 0 | 1,290,420,224 | 15,351,808 | | 307 ms | 19,806,418 B/s |
| A | after the link returns | 76 | 77 | 78 | 0 | 1,305,968,640 | 14,123,008 | 58 ms | 110 ms | 19,647,088 B/s |
| A | after the page opens again | 153 | 154 | 103 | 0 | 1,728,053,248 | 0 | 250 ms | 304 ms | 19,733,439 B/s |
| B | until the cut | 0 | 1 | 36 | 0 | 598,638,592 | 11,436,032 | | 577 ms | 19,814,198 B/s |
| B | after the link returns | 35 | 36 | 37 | 0 | 611,909,632 | 7,929,856 | 61 ms | 114 ms | 19,298,977 B/s |
| B | after the page opens again | 71 | 72 | 48 | 0 | 801,086,971 | 0 | 250 ms | 303 ms | 19,876,751 B/s |
| C | until the cut | 0 | 1 | 20 | 0 | 322,420,736 | 3,653,632 | | 105 ms | 24,238,122 B/s |
| C | after the link returns | 19 | 20 | 20 | 0 | 327,811,072 | 9,043,968 | 6 ms | 7 ms | 22,669,853 B/s |
| C | after the page opens again | 38 | 39 | 26 | 0 | 436,207,616 | 0 | 43 ms | 45 ms | 23,883,075 B/s |
| D | until the cut | 0 | 1 | 20 | 0 | 322,551,808 | 3,784,704 | | 705 ms | 5,299,692 B/s |
| D | after the link returns | 19 | 20 | 20 | 0 | 327,286,784 | 8,519,680 | 154 ms | 306 ms | 5,245,237 B/s |
| D | after the page opens again | 38 | 39 | 26 | 0 | 436,207,616 | 0 | 650 ms | 802 ms | 5,294,472 B/s |

Time from the cut to Uppy's `upload-error`: 1,116 ms (A), 1,133 ms (B), 1,131 ms (C), 1,126 ms (D) and 1,121 ms (E). Uppy's message every time: "This looks like a network error, the endpoint might be blocked by an internet provider or a firewall." The outage was 5,000 ms from the cut to the retry in every run.

ListParts pages per call in run A, in order of the calls (resume after the cut, resume after the page, completion, the uneven-parts check): 1, 2, 3 and 1.

### Requests per part (run E)

| Phase | Parts signed | Requests through the storage proxy | Bytes through the proxy | Resent bytes | Throughput |
|---|---|---|---|---|---|
| until the cut | 5 | 10 | 82,739,200 | 15,630,336 | 20,016,054 B/s |
| after the link returns | 6 | 12 | 95,944,704 | 12,058,624 | 16,687,187 B/s |
| after the page opens again | 7 | 14 | 117,440,512 | 0 | 19,718,437 B/s |

### Protocol checks, the same in runs A to E

| Check | What happened |
|---|---|
| Uneven parts of 16 MiB, 15 MiB and 9 MiB plus 3 bytes for a 40 MiB plus 3 byte upload | The API refused the completion with 400 "part 2 has 15728640 bytes, expected 16777216". MinIO then completed the same parts when asked directly |
| Signing a part with an upload ID and a key that do not belong together | 403 from the API |
| A part URL signed for 2 s and used after 3.5 s | MinIO answered 403 `AccessDenied`, with `Access-Control-Allow-Origin` set to the app origin. A fresh URL for the same part answered 200 with an ETag |
| Abort through the API after one part | 1 open upload under the key before, 200 from the API, 0 after |
| CORS preflight for `PUT` from the app origin | 204, `Access-Control-Allow-Origin` the app origin, `Access-Control-Allow-Methods` `PUT` |
| CORS preflight from another origin | 204 with no `Access-Control-Allow-Origin` |
| Part `PUT` from the app origin | 200, `Access-Control-Expose-Headers` includes `Etag` |
| Lifecycle rule with `AbortIncompleteMultipartUpload` after 1 day on the quarantine prefix | Refused: "The XML you provided was not well-formed or did not validate against our published schema" |
| Lifecycle rule with `Expiration` after 7 days on the same prefix | Accepted and read back |

### Spike cost

Writing the 4 GiB file took 2.6 s and hashing it 7.1 s. No cloud service was used, so the cost is $0.

## Interpretation

- The task's bar is met with a synthetic 4 GiB file in place of a 4 GB NDPI. In every run the upload resumed after the cut link and after the closed page, no part that storage already held was signed or sent again, and the object was byte-identical to the source. The real 1.99 GB NDPI behaved the same way.
- A disconnect costs at most the one part in flight, because Uppy sends one part of a file at a time. The resent bytes per interruption stayed below 16 MiB in every run, and the phase after the last interruption resent nothing.
- Resuming is fast. After the link returned, the first new part was signed 7 to 306 ms after the retry, which is one ListParts and one signature, each one round trip. After a closed page it took 45 to 802 ms, which adds the page load, picking the file and the open upload lookup. Uppy itself needed about 1.1 s to give up on the dead link, which matches its retry delays of 150, 300 and 600 ms.
- Sending one part at a time costs throughput. With no added RTT the link was used at 91 to 97% (run C), at 50 ms RTT at 77 to 80% (runs A and B, and 67 to 80% in the short phases of run E), and at 150 ms RTT on a 50 Mbit/s link at 84 to 85% (run D). Run E shows 2 requests at the storage proxy for every part. That fits one CORS preflight plus one `PUT` per part, because every presigned URL is a new URL and the browser's preflight cache is keyed by URL (interpretation, the request methods were not logged). Each part then pays three round trips: the signature, the preflight and the `PUT`. A larger part or parallel parts within a file would win some of it back, which ADR 0116 (resumable uploads with S3 multipart and Uppy) leaves as a TODO for INGEST-002 (upload UI with resume).
- MinIO accepts what R2 refuses, uneven parts, and sends what R2 does not, CORS headers on an expired URL. Tests against MinIO cannot stand in for R2 on either point, so the API's own part size check is required and INGEST-028 (upload protocol check on the R2 dev bucket) must repeat these checks on R2.
- MinIO refused the `AbortIncompleteMultipartUpload` lifecycle rule, so the lifecycle backstop could not be tested locally. The API's own stale upload job does not depend on it.
- The proxy counts bytes forwarded to MinIO, not bytes the browser sent, so a few kilobytes buffered in the proxy at a cut may be missing from the resent figures (assumption).
- All parts ran over loopback, so real TCP effects over a long path, such as slow start for every new connection, are not in these numbers (assumption).

## Follow-ups

- [ADR 0116](../adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md) (resumable uploads with S3 multipart and Uppy), Proposed.
- INGEST-028 (upload protocol check on the R2 dev bucket) runs the same checks against `parfocal-dev`.
- INGEST-001 (upload API with presigned multipart) and INGEST-002 (upload UI with resume) were edited to follow ADR 0116 (resumable uploads with S3 multipart and Uppy).
- TODO: measure browser memory while Uppy slices a 4 GiB file. It was not measured here.
- TODO: measure throughput with parallel parts within one file if INGEST-002 (upload UI with resume) finds single large uploads too slow on real links.
