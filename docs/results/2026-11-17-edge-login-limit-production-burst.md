# Result: the production edge Worker refuses the eleventh login from one address with a 429 and lets the address sign in again 64 s later

- Date: 2026-11-17
- Backlog: SEC-027 (edge limits per IP)
- Kind: check
- Commit: the Worker with the `LoginCounter` Durable Object from `7562e7e6` (count logins per address strictly), reached through `https://app.parfocal.eu`. The Worker version was not read, because the run only sent requests.
- Environment: `https://app.parfocal.eu` (the development environment, [ADR 0390](../adr/0390-app-parfocal-eu-is-a-development-environment.md)), one MacBook on IPv4 only
- Cost: 28 Worker requests, 10 of them answered by short Modal API calls, well under $0.01

This repeats the [earlier check](2026-11-16-edge-rate-limits-production-check.md), where 30 logins in 23 s all passed the approximate binding.

## Question

Does a login flood from one address now get the 429 `rate-limited` problem at login 11, for how long does the block last, and does sign-in work afterwards?

## Method

1. Sent `GET /api/auth/login?return_to=/` with `curl -4`, one request at a time, at most 15, stopping at the first 429. The route only redirects to the sign-in page, so no account of the owner or the smoke test was touched.
2. Polled the same route every 5 s until it stopped answering 429, then `GET /api/health`.

## Results

| Check | Outcome |
|---|---|
| Logins 1 to 10, 23:28:26 to 23:28:28 UTC | 302 to the sign-in page |
| Login 11, 23:28:28 UTC | 429, `application/problem+json`, code `rate-limited`, `Retry-After: 58` |
| Polls while blocked, 23:28:33 to 23:29:25 UTC | 429 each time, 11 polls |
| First poll that passed | 23:29:30 UTC, 302, 64 s after the first counted login |
| `/api/health` afterwards | 200 |

## What it means

The strict counter is live and refuses exactly at login 11, with the same problem contract as the API. The block lasts until the oldest counted login leaves the 60 s window, and refused polls did not extend it. Sign-in works again right after, so the Done when check holds from the Mac. The earlier finding that the binding alone is too loose is closed by the counter.

## Limits

One run from one IPv4 address. The second-address half still runs only locally in the Worker tests, because this Mac has no IPv6 address and the deployed Worker ignores the test address header. The 429 was not told apart from the binding's 429 by its body, because both use the same problem, but the binding did not stop 30 logins earlier and this one stopped at 11.
