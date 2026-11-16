# Result: the camelyon-tumor v1.0 ONNX artifact in R2 matches the local export

- Date: 2026-11-16
- Backlog: AITUM-011 (the tumor map pool is ready to deploy)
- Kind: production artifact check
- Commit: the AITUM-011 commit (`workers/ml/spike/publish_tumor_onnx.py`)
- Environment: Apple M4, local MinIO, Cloudflare R2 bucket `parfocal-dev` through the `parfocal-dev local` key

## Question

Does the artifact the tumor map pool fetches hold the same bytes as the export whose parity ADR 0356 (the tumor map worker runs the ResNet18 as ONNX) measured?

## Method

```
uv run --frozen --all-packages python workers/ml/spike/publish_tumor_onnx.py \
  ~/.cache/parfocal/models/onnx/camelyon-tumor.onnx --target minio --bucket parfocal-local
uv run --frozen --all-packages python workers/ml/spike/publish_tumor_onnx.py \
  ~/.cache/parfocal/models/onnx/camelyon-tumor.onnx --target r2 --bucket parfocal-dev
```

The script refuses a file that is not the parity export, publishes through `ModelArtifacts.publish` (each object written with `If-None-Match: *`), then fetches the file back through `ModelArtifacts.fetch` and hashes it. `models/` in `parfocal-dev` was empty before, checked by listing it and a non-empty `fixtures/` prefix.

## Results

| Measure | Value |
|---|---|
| Local export | 44,701,121 bytes, SHA-256 `9f5e526f6b4f6dd3c9a58df9d40a4ce600a4a97e854ee9b77165a18d6e2400f1` |
| Manifest `models/camelyon-tumor/v1.0/manifest.json` | the same size and SHA-256, kind `onnx` |
| Fetched back from MinIO `parfocal-local` | the same SHA-256 |
| Fetched back from R2 `parfocal-dev` | the same SHA-256 |
| Cost | 44.7 MB stored, about $0.0007 a month, and two writes inside the free tier |

## Limits

- Fetched from a Mac, not from a Modal container. The first deploy checks the container's fetch.
