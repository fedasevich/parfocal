# Upload spike

The spike for STACK-039 (resumable upload protocol), proposed in [ADR 0116](../../docs/adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md) (resumable uploads with S3 multipart and Uppy). It uploads one large file from headless Chromium with Uppy's AWS S3 plugin to MinIO in Docker, cuts the link mid-upload, closes the page later, and proves each time that the upload resumes from the parts already stored. The numbers are in the [result file](../../docs/results/2026-10-31-resumable-upload-spike.md).

## What runs

| Piece | Stands in for |
|---|---|
| `pgsty/minio` in Docker, pinned by digest | R2's S3 API |
| `src/upload-api.ts` | The upload routes of INGEST-001 (upload API with presigned multipart). It speaks Uppy's Companion S3 contract, chooses the key under a tenant prefix and the part size, signs one part URL at a time, lists parts with pagination and refuses a completion whose parts are not all one size |
| `src/page.ts` | The upload screen of INGEST-002 (upload UI with resume), without a UI. It loads the published Uppy 6 bundle |
| Two `@parfocal/latency-proxy` instances | The network, with an RTT on both and an uplink cap towards storage. Closing them is the forced disconnect |
| `scripts/spike.ts` | The driver. It makes the file, runs the upload, checks every part and the object's SHA-256, runs the protocol checks and prints a JSON report |

## Running it

Docker must be running. Ports 9150 to 9152 must be free.

```
pnpm --filter @parfocal/upload-spike spike                       # 4 GiB synthetic file, 200 Mbit/s up, 50 ms RTT
pnpm --filter @parfocal/upload-spike spike -- --size-mib 256     # the same at 256 MiB, about 20 s
pnpm --filter @parfocal/upload-spike spike -- --source ~/.cache/parfocal/fixtures/OS-1.ndpi
```

| Flag | Default | Meaning |
|---|---|---|
| `--target` | `minio` | `minio` or `r2` |
| `--size-mib` | 4096, 1024 on R2 | Size of the synthetic random file |
| `--source` | none | Upload this file instead of a synthetic one |
| `--part-mib` | 16 | Preferred part size, grown if the file needs more than 10,000 parts |
| `--rtt-ms` | 50, 0 on R2 | Round-trip time added to every request |
| `--uplink-mbit` | 200, none on R2 | Upload bandwidth towards storage, 0 for no limit |
| `--cut-at` | 0.3 | Share of the file sent before the link is cut |
| `--outage-s` | 5 | How long the link stays down |
| `--reload-at` | 0.6 | Share of the file stored before the page is closed and opened again |
| `--expiry-s` | 300 | Lifetime of each presigned part URL |
| `--list-page` | 100, 25 on R2 | Parts per ListParts page, small so that pagination is exercised |
| `--copy-part-mib` | 300 | Range size of the `UploadPartCopy` check |
| `--app-origin` | the app proxy, `http://localhost:5173` on R2 | Origin the page is served at |
| `--env-file` | the repository's `.env` | Where the R2 credentials are read |
| `--workdir` | the system temp folder | Where the synthetic file is written. It is deleted afterwards unless `--keep-file` is set |
| `--out` | none | Also write the JSON report to this file |

The container is started with `--rm` and removed with its volume when the run ends, also after a failure. The run exits with an error when any check fails.

## Running it against R2

`--target r2` repeats the run on the `parfocal-dev` bucket for INGEST-028 (upload protocol check on the R2 dev bucket). It reads `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` from `--env-file` (the repository's `.env` by default), refuses any bucket but `parfocal-dev`, and reads the bucket's CORS and lifecycle settings through the Cloudflare API with `CLOUDFLARE_API_TOKEN` and `R2_ACCOUNT_ID`, because the object token cannot. It never writes bucket settings, which belong to `infra/tofu`.

```
pnpm --filter @parfocal/upload-spike spike -- --target r2
```

Every key sits under `t/spike-{run}/`, which the run deletes at the end, also after a failure, and the report counts every storage request. The page is served at `http://localhost:5173`, the dev origin the bucket CORS rule allows, by the app proxy listening on port 5173, so that port must be free (stop `pnpm dev` first). Playwright route interception would avoid the port, but it answers CORS preflights itself, so R2's own preflight answer would never reach the browser. Storage requests still pass the latency proxy, now able to forward to an https target, so the link can be cut, but with no added RTT or uplink limit unless asked. Defaults change to 1 GiB, 25 parts per ListParts page and 300 MiB ranges for the `UploadPartCopy` check. The S3 client sends checksums only when an operation requires them, because the newer AWS SDK otherwise adds CRC32 values that R2 has refused in the past.
