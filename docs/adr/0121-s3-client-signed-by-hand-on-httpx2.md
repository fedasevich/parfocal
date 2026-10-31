# 0121. An S3 client signed by hand on httpx2, tested against MinIO

- Date: 2026-10-31
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: INGEST-001 (upload API with presigned multipart). Touches INGEST-028 (upload protocol check on the R2 dev bucket), INGEST-025 (import slides from a link), STACK-025 (object storage, CDN and signed access) and the ingest steps that read uploads

## Context

INGEST-001 (upload API with presigned multipart) is the first Python code that talks to object storage. Per [ADR 0116](0116-resumable-uploads-with-s3-multipart-and-uppy.md) (resumable uploads with S3 multipart and Uppy) the API creates a multipart upload, presigns one part `PUT` at a time, lists parts with pagination, completes and aborts, all against R2 in the cloud and MinIO locally. The API is async FastAPI on Modal, and cold starts and image size count. No AWS library is in the dependency tree today, and `httpx2` already is. The ingest worker will later need to read the same objects, so the client is shared code in `parfocal_common`. STACK-025 (object storage, CDN and signed access) still owns how slides are read and served, and this record does not decide it.

## Options considered

1. boto3. The reference S3 client, well documented and correct. It is synchronous, so every call needs a thread in an async route. botocore is a large package of service JSON, and since botocore 1.36 it adds checksum headers by default, which a browser `PUT` to a presigned URL would not send, so it needs `request_checksum_calculation="when_required"` (unverified here, from the botocore changelog).
2. aiobotocore or aioboto3. Async wrappers over botocore with the same correctness and the same checksum defaults. They add aiohttp, multidict, yarl, wrapt and aioitertools beside the httpx2 stack the API already has, and aiobotocore pins botocore to a narrow range, which makes upgrades move in lockstep.
3. Signing by hand on httpx2. AWS Signature Version 4 is a published algorithm of about 60 lines, and the API needs only five operations, create, list parts, complete, abort and presign a part. Nothing new is installed and the calls stay async on the client the API already uses. The risk is a signing mistake, and that every new operation (a ranged `GET` for the worker, for example) has to be added by hand.

## Decision

Option 3. `parfocal_common.object_store` signs requests and presigned URLs itself and sends them with httpx2, path style, with region `auto` for R2. The signing risk is covered three ways: unit tests reproduce two signatures published by AWS (the query-string example at https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html and the header example at https://docs.aws.amazon.com/AmazonS3/latest/API/sig-v4-header-based-auth.html), the database test suite runs every operation against MinIO, which checks signatures, including a key with spaces and brackets, and a tampered part URL is refused with 403. Presigned part URLs sign only the `host` header with `UNSIGNED-PAYLOAD`, so the browser may send any `Content-Type` and no checksum header is involved.

Tests use MinIO, not an in-process fake. moto's in-process mock only intercepts botocore and would not see a plain HTTP `PUT` to a presigned URL, and moto's server does not check signatures, so neither would prove the signer. MinIO runs as the `storage` service in `compose.yaml`, which the `db` CI job already starts.

## Consequences

- `parfocal_common` depends on httpx2. The API's dependency list does not grow.
- A new storage operation is added to `ObjectStore` with a test against MinIO. The worker's reads under STACK-025 (object storage, CDN and signed access) or INGEST-007 (sidecar tile index) add a ranged `GET` the same way.
- MinIO accepts things R2 refuses, such as uneven parts ([knowledge/uploads.md](../knowledge/uploads.md)), so INGEST-028 (upload protocol check on the R2 dev bucket) must also run this signer against `parfocal-dev` before INGEST-001 (upload API with presigned multipart) is ticked.
- If the hand signer ever disagrees with R2 in a way that is costly to chase, switching to aiobotocore behind the same `ObjectStore` methods is a contained change.
