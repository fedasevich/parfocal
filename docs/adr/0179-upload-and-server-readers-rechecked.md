# 0179. Upload protocol and server slide readers rechecked in November 2026

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: INGEST-000 (research check for upload and server readers), STACK-026 (slide reading and tiling on the server), STACK-039 (resumable upload protocol). Adds INGEST-030 (name the OME-TIFF reader after tifffile)

## Context

INGEST-000 asks whether [ADR 0043](0043-server-slide-reading.md) (server slide reading, STACK-026) and [ADR 0116](0116-resumable-uploads-with-s3-multipart-and-uppy.md) (resumable uploads, STACK-039) still hold. ADR 0043 is from 2026-10-15 and ADR 0116 from 2026-10-31, and both have been built since: the ingest worker in `workers/ingest` reads slides, and the web app ships Uppy. Nothing was measured here. Versions come from the PyPI JSON API and the npm registry, read on 2026-11-03, and change notes from the GitHub release pages and the Uppy changelog on the same day. The R2 facts rest on INGEST-028 (upload protocol check on the R2 dev bucket), which ran against `parfocal-dev` on 2026-11-02 ([result](../results/2026-11-02-upload-protocol-check-on-r2.md)). The Cloudflare docs host was unreachable from this session, and the GitHub API was refused for these repositories, so no R2 doc page was read again.

## Findings

### Server readers (STACK-026)

| Library | Locked in `uv.lock` | Latest release | What changed |
|---|---|---|---|
| openslide-python | 1.4.6 | 1.4.7, 2026-10-24 | Version independent wheels for free-threaded Python 3.15 and a newer OpenSeadragon in the examples. Nothing for Python 3.14. The range `>=1.4.6,<2` already admits it |
| openslide-bin (OpenSlide C library) | 4.0.1.2 | 4.0.1.2, 2026-06-20 | None. OpenSlide 4.0.1 is still the newest library release. It fixed CVE-2026-48977, where a crafted Ventana BIF could write memory at chosen offsets, so the floor `>=4.0.1` must stay |
| tifffile | 2026.10.15 | 2026.10.15 | None |
| wsidicom | 0.36.1 | 0.36.1, 2026-09-28 | None |
| tiffslide | not a dependency | 4.0.0, 2026-07-03 | None since ADR 0043 |
| zarr-python | not a dependency | 3.4.2, 2026-10-27 | Not used, see below |
| TIAToolbox | not a dependency | 2.1.3, 2026-07-21 | Left to AIP-000 (AI research check), as ADR 0043 rule 7 says |

What the built worker does differs from ADR 0043 in two places ([knowledge/slide-formats.md](../knowledge/slide-formats.md)).

1. OME-TIFF is not read by tiffslide. `parfocal_ingest.pyramid` reads every TIFF-family level table with tifffile series, takes the OME-TIFF scale from the OME XML, and reads OME-TIFF reference tiles and associated images with tifffile too. tiffslide was never added to `workers/ingest/pyproject.toml`. The reader name stored with each slide is still the string `tiffslide`, which is wrong and is INGEST-030.
2. OME-Zarr has a server reader now. `parfocal_ingest.zarr_index` reads the multiscale JSON and the chunk files directly, without zarr-python, and refuses sharded arrays until VIEW-017 (sharded OME-Zarr reading). This closes the OME-Zarr TODO of ADR 0043 for unsharded stores.

### Upload protocol (STACK-039)

| Item | Locked | Latest | What changed |
|---|---|---|---|
| `@uppy/core` | 6.3.0 | 6.3.0, 2026-10-16 | None since the lock |
| `@uppy/aws-s3` | 6.3.0 | 6.3.0, 2026-10-16 | 6.2.1 honours `shouldUseMultipart: true` for files of 5 MiB or less again. 6.3.0 escapes the key in `location` for single-request uploads and lets `signRequest` return POST policy fields. Neither touches the Companion multipart contract of ADR 0116, and part concurrency within one file is unchanged |
| `@uppy/s3` | not used | 0.2.0, 2026-10-16 | A new package that browses and imports files already in S3-compatible storage, R2 included. It does not upload from the device, so it is no alternative to `@uppy/aws-s3` |
| `@uppy/golden-retriever` | not used | 6.0.0, 2026-08-26 | Still optional, as ADR 0116 says |
| tus-js-client | not used | 4.3.1 stable, 5.0.0-pre3 on 2026-09-30 | Nothing that removes the tus server from the byte path, which was the reason to reject tus |
| R2 multipart rules | | | INGEST-028 confirmed every rule ADR 0116 builds on and corrected two doc facts that ADR 0116 already records. No newer R2 source could be read here |

## Decision

Confirm STACK-039 as ADR 0116 says, with no change. Confirm STACK-026 as ADR 0043 says, revised in two rules to match what was built.

- Rule 2 of ADR 0043 now reads: tifffile reads OME-TIFF, with the scale from the OME XML. tiffslide is not a dependency. It stays the candidate second reader for the agreement tests and the fallback for a plain TIFF that OpenSlide refuses, and is added only when a fixture needs it.
- The OME-Zarr row of ADR 0043 now reads: the ingest worker's own reader in `parfocal_ingest.zarr_index`, unsharded only until VIEW-017. zarr-python is not added.
- Every other rule of ADR 0043 stands: OpenSlide is the reader of record, tifffile checks structure, wsidicom reads DICOM, and the reader is chosen by content.
- No dependency changes now. openslide-python 1.4.7 brings nothing for Python 3.14, and the lock picks it up at the next routine update.

## Consequences

- INGEST-030 (name the OME-TIFF reader after tifffile) renames the stored reader value, with a migration for existing slides.
- ADR 0043 carries a pointer to this record.
- This check did not revisit the other open TODOs of ADR 0043, such as a real OME-TIFF slide fixture, range reads from R2 and the JPEG 2000 YCbCr difference. They stay where ADR 0043 and later records left them.
- TODO: the Cloudflare R2 docs and changelog were not reachable from this session. The next research check should read them again, and INGEST-028's numbers stay the source of record until then.
