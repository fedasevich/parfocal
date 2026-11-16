# Result: 30 logins from one address in 23 s got no 429 from the production edge Worker

- Date: 2026-11-16
- Backlog: SEC-027 (edge limits per IP)
- Kind: check
- Commit: production Worker version `86ab78d7-c24b-446c-b234-fa827a7d5f15`, deployed 2026-11-13 from `2ca85745`, which contains the SEC-027 limit code
- Environment: `https://app.parfocal.eu` (production), one MacBook on IPv4 only, served by the Cloudflare AMS location
- Cost: about 31 Worker requests and 30 short Modal API calls that each answered with a redirect, well under $0.01

## Question

Does the production edge Worker answer a login flood from one client address with 429 once `LOGIN_LIMIT` (10 requests a minute) runs out?

## Method

1. Read the last successful deploy log. Wrangler listed `env.LOGIN_LIMIT (10 requests/60s)` and the other four rate limit bindings, and `wrangler deployments list --env production` shows that version live at 100%.
2. Sent `GET /api/auth/login?return_to=/` with `curl -4` one request at a time, at most 30, stopping at the first 429. Then one `GET /api/health`.

## Results

| Check | Outcome |
|---|---|
| Rate limit bindings in the live version | All five present |
| Statuses of 30 logins from one address, 07:36:19 to 07:36:42 UTC | 30 times 302 to the Zitadel authorize page, no 429 |
| Worker in the path | Yes, the responses carry the edge security headers and a Modal call id |
| `/api/health` afterwards | 200 |

## What it means

The limit code and its binding are live, yet a login flood three times the limit was not refused. Cloudflare documents the binding as approximate, counted per location from a locally cached count that synchronises in the background, so one address can pass the limit before the counts meet. Thirty sequential requests over 23 s going through suggests the binding is too loose to stop a slow login flood. A strict limit across locations needs a Durable Object, which Cloudflare names as the way to get one.

## Limits

One run from one address. The second-address half of the check could not run, because this Mac has no IPv6 address and the production Worker ignores the test address header. The Worker does not log limit outcomes, so the run cannot tell whether `limit()` returned true every time or the requests spread over several machines.
