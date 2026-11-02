# Upload UI resume after a reload, 1 GiB over a throttled link

Task INGEST-002 (upload UI with resume). Spec: `apps/web/e2e/upload-resume.spec.ts`. Run once on 2026-11-02 on the owner's Mac with Chrome headless, Playwright 1.64.0, `@uppy/core` and `@uppy/aws-s3` 6.3.0, and MinIO `pgsty/minio` as a stand-in for R2.

## What ran

The page was the real upload drawer of the web app on fake data. The routes it called were the spike's upload stand-in, which speaks the same Companion contract as `parfocal_api.uploads` (create answers 201 with `part_size`, `open` answers with the key and upload ID). The real API and a real R2 bucket were not part of this run. Part requests went through `@parfocal/latency-proxy` with an uplink limit. The synthetic file was random bytes named `slide-1g.bin`.

## Result

| Measure | Value |
|---|---|
| File size | 1,073,741,824 bytes, 64 parts of 16 MiB |
| Uplink limit | 400 Mbit/s |
| Round trip added | 20 ms |
| Reload when the proxy had received | 419,430,400 bytes (25 parts) |
| Bytes the proxy received after the file was picked again | 654,311,424 |
| Sum of both | 1,073,741,824, equal to the file size |
| Parts signed | 64 of 64, each part number once |
| Parts sent again | 0 |
| Create calls | 1 |
| Object in storage | 1,073,741,824 bytes, SHA-256 equal to the source |
| Wall time of the test | 53 s, which includes writing and hashing the 1 GiB file |

The reload happened between two parts in this run. The spec allows one part to be sent again, because a part in flight at the reload is lost and is sent whole.

## Other checks in the same spec

- Pause stopped the bytes reaching the proxy within the 1.5 s window, and Resume continued.
- Cutting the link showed "Trying again", the app retried by itself after the link came back, and the object matched the source SHA-256 with every part number signed once.
- Cancel aborted the upload in storage and left no open multipart upload.
