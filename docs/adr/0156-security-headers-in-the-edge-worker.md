# 0156. The edge Worker sets every security header, runs before static assets and sends HSTS with subdomains

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas (owner standing approval, ADR 0151)
- Backlog: SEC-011 (security headers and CSP). Refines ADR 0050 (deploy pipeline and previews)

## Context

The app needs COOP and COEP for module workers, SharedArrayBuffer and WASM threads, a CSP that still lets the viewer reach tiles and uploads reach R2, and HSTS. ADR 0050 routed only some paths through the Worker and served the rest as static assets, which would leave assets without headers.

## Options considered

| Option | For | Against |
|---|---|---|
| Headers in a `_headers` file for assets plus the Worker for routes | No Worker run per asset | Two places to keep in step, and no per-page nonce |
| The Worker runs first for every request (`run_worker_first: true`) and sets all headers | One place, a fresh nonce per page | A Worker run per asset request, inside the paid plan's included requests |

## Decision

The Worker runs first and sets a nonce CSP with `style-src 'self' 'unsafe-inline'`, because libraries inject styles, plus COOP, COEP `credentialless`, CORP, `Referrer-Policy: same-origin`, a Permissions-Policy and HSTS with `includeSubDomains`. Every subdomain of `parfocal.eu` is served by Cloudflare over HTTPS, so the subdomain rule costs nothing today. It is the one header that is costly to undo, because browsers keep it for its max-age. Each environment sets the Worker variable `UPLOAD_ORIGIN` to the R2 endpoint so presigned uploads pass the CSP.

## Consequences

This replaces the route pattern list of ADR 0050 for the edge. The staging header test, `PARFOCAL_HEADERS_URL=<url> node --test apps/edge/test/deployed-headers.test.ts`, runs after the first staging deploy, and SEC-011 stays blocked until then. The local check is in [the result file](../results/2026-11-02-security-headers-local-check.md).
