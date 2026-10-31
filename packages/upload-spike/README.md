# Upload spike

The spike for STACK-039 (resumable upload protocol), decided in [ADR 0116](../../docs/adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md). It uploads one large file from headless Chromium with Uppy's AWS S3 plugin to MinIO in Docker, cuts the link mid-upload, closes the page later, and proves each time that the upload resumes from the parts already stored. The numbers are in the [result file](../../docs/results/2026-10-31-resumable-upload-spike.md).

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
| `--size-mib` | 4096 | Size of the synthetic random file |
| `--source` | none | Upload this file instead of a synthetic one |
| `--part-mib` | 16 | Preferred part size, grown if the file needs more than 10,000 parts |
| `--rtt-ms` | 50 | Round-trip time added to every request |
| `--uplink-mbit` | 200 | Upload bandwidth towards storage |
| `--cut-at` | 0.3 | Share of the file sent before the link is cut |
| `--outage-s` | 5 | How long the link stays down |
| `--reload-at` | 0.6 | Share of the file stored before the page is closed and opened again |
| `--expiry-s` | 300 | Lifetime of each presigned part URL |
| `--list-page` | 100 | Parts per ListParts page, small so that pagination is exercised |
| `--workdir` | the system temp folder | Where the synthetic file is written. It is deleted afterwards unless `--keep-file` is set |
| `--out` | none | Also write the JSON report to this file |

The container is started with `--rm` and removed with its volume when the run ends, also after a failure. The run exits with an error when any check fails.
