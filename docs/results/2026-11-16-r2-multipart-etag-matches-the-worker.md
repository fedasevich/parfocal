# Result: the S3 ETag of a multipart upload to R2 equals the Worker binding's etag

- Date: 2026-11-16
- Backlog: TILES-009 (a rewritten original never comes from a stale edge cache)
- Kind: check
- Commit: the TILES-009 commit, run from the working tree on top of 10d83a62
- Environment: MacBook (Apple M4, 24 GB) shared with three other agents. Python side is `parfocal_common.object_store.ObjectStore.stat_object` over the R2 S3 API with the "parfocal-dev local" token from `.env`. Worker side is a 10 line probe under `wrangler dev` (wrangler 4.161.0) with a remote R2 binding to `parfocal-dev`, run from the scratchpad, so nothing was deployed
- Data: one random object of 5,243,904 bytes at `agent-tests/tiles-009-etag-check/multipart.bin` in `parfocal-dev`, uploaded as two parts (5 MiB and 1 KiB) and deleted at the end

## Question

The API now signs the original's ETag from an S3 HEAD into the tile token, and the Worker compares it with what the R2 binding reports. Are the two the same string for a multipart upload, whose ETag is not a plain MD5?

## Method

1. Created the multipart upload, sent the two parts, completed it and read the ETag from the completion reply and from `stat_object`.
2. Asked the probe Worker for `env.SLIDES.head(key)` and read `etag` and `httpEtag`.
3. Deleted the object and confirmed `stat_object` returns nothing.

## Results

| Source | Value |
|---|---|
| S3 CompleteMultipartUpload ETag, unquoted | `d8e38953c21bae7d553f3b33fc3d8343-2` |
| S3 HEAD ETag through `stat_object`, unquoted | `d8e38953c21bae7d553f3b33fc3d8343-2` |
| Worker binding `object.etag` | `d8e38953c21bae7d553f3b33fc3d8343-2` |
| Worker binding `object.httpEtag` | `"d8e38953c21bae7d553f3b33fc3d8343-2"` |
| Size from S3 HEAD and from the binding | 5,243,904 and 5,243,904 |
| `stat_object` after the delete | none |

## Interpretation

- The unquoted S3 ETag the API signs equals `object.etag`, and `httpEtag` is the same value in quotes, so the Worker's plain string compare with `"${etag}"` is right for multipart originals.
- The `-2` suffix means a multipart ETag is not 32 hex characters, which is why the token accepts letters, digits and hyphens up to 80 characters.
- A single part upload was not checked against R2 here. The API test checks that MinIO returns the plain MD5 for one.

## Cost

Five Class A operations (create, two parts, complete, delete) and two Class B operations (two HEADs) plus one binding HEAD, all inside the R2 free tier, so $0.00.
