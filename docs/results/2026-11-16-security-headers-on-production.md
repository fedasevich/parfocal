# Result: production already serves every SEC-011 security header, with a fresh CSP nonce per request

- Date: 2026-11-16
- Backlog: SEC-011 (security headers and CSP)
- Kind: check
- Commit: the SEC-011 smoke commit on top of 8f1b9d23
- Environment: MacBook, curl and Python urllib against `https://app.parfocal.eu`, read only. Cost $0
- Data: none, the public sign-in page and `/api/health`

## Question

Is the edge Worker code from SEC-011 (ADR 0156, security headers in the edge Worker) deployed, so that the production smoke step can check its headers after each deploy?

## Method

1. `curl -D -` on `/` (with and without `Sec-Fetch-Mode: navigate`) and on `/api/health`.
2. `PARFOCAL_HEADERS_URL=https://app.parfocal.eu node --test apps/edge/test/deployed-headers.test.ts`.
3. `pnpm --filter @parfocal/deploy run smoke` with the new `security_header_problems` check.

## Results

| Header | `/` | `/api/health` |
|---|---|---|
| `content-security-policy` | nonce, `'strict-dynamic'`, `'wasm-unsafe-eval'`, `worker-src 'self' blob:`, connect to the R2 upload origin, `object-src`, `base-uri`, `frame-src` and `frame-ancestors` all `'none'` | absent, JSON needs none |
| `cross-origin-opener-policy` | `same-origin` | `same-origin` |
| `cross-origin-embedder-policy` | `credentialless` | `credentialless` |
| `cross-origin-resource-policy` | `same-origin` | `same-origin` |
| `referrer-policy` | `same-origin` | `same-origin` |
| `permissions-policy` | `hid`, `gamepad`, `fullscreen`, `cross-origin-isolated` self, 10 features off | same |
| `x-content-type-options`, `x-frame-options` | `nosniff`, `DENY` | `nosniff`, `DENY` |
| `strict-transport-security` | `max-age=31536000; includeSubDomains` | same |

The deployed header test passed (1 of 1). The page showed `cf-cache-status: HIT` yet each request carried a different nonce, so the edge cache does not freeze the nonce. The smoke command passed.

## Limits

This checks headers only. The ONNX WASM threads and module workers part rests on the local browser check of 2026-11-02 ([security headers local check](2026-11-02-security-headers-local-check.md)), not on a browser run against production.
