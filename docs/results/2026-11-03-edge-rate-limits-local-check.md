# Result: a login flood from one address gets 429 from the edge Worker while another address signs in, checked locally

- Date: 2026-11-03
- Backlog: SEC-027 (edge limits per IP)
- Kind: check
- Commit: the SEC-027 commit, measured from the working tree on top of ec77538
- Environment: MacBook, Node 26, `wrangler dev --local` 4.156.1 (Miniflare simulates the rate limiting binding), `http://localhost:5191`. No cloud resource was used, cost $0
- Data: a stub `index.html` as the static assets, no API behind `/api`

## Question

Does the Worker answer a login flood from one client address with 429 once the `LOGIN_LIMIT` binding (10 requests a minute) runs out, while a second address still gets through?

## Method

1. `pnpm dlx wrangler@4 dev --local --port 5191 --var TRUST_TEST_CLIENT_ADDRESS:true` from `apps/edge`. The var lets the header `X-Parfocal-Test-Client-Address` stand in for `CF-Connecting-IP`, so one machine can act as two addresses. It is set only on this command line, never in `wrangler.jsonc`.
2. `PARFOCAL_RATE_LIMIT_URL=http://localhost:5191 node --test apps/edge/test/deployed-rate-limits.test.ts`.
3. Twelve `curl` calls to `/api/auth/login` from one address, then one from another.

## Results

| Check | Outcome |
|---|---|
| Deployed rate limit test against the local Worker | Passed |
| Statuses of 12 logins from one address | 10 times 200, then 429 and 429 |
| `Retry-After` on the 429 | 60 |
| 429 body and headers | `application/problem+json`, `Cache-Control: no-store`, COEP `credentialless` |
| Next login from another address | 200 |

## Limits

The 200s are the SPA fallback, because the Worker does not yet forward `/api` to the API on Modal, so "signs in" here means "not limited". On Cloudflare the binding is approximate and counts per location, so a flood may pass a few requests over 10. The preview run of the same test, which uses IPv4 for the flood and IPv6 for the second address, has not run, because nothing was deployed. The Turnstile check is covered only by unit tests with a fake siteverify.
