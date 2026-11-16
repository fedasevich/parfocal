# Result: a viewer session at script pace makes about 150 API requests per three slides, up to 1,474 in a full minute

- Date: 2026-11-16
- Backlog: SEC-050 (the per-person rate limit fits a real viewer session)
- ADR: [0088](../adr/0088-rate-limits-in-postgres-and-at-the-edge.md) (rate limits in Postgres and at the edge), whose defaults this changes

## Question

How many API requests does one person's busy viewer session make per minute, and what per-person limit keeps that session clear of 429 while a flooding script still gets it?

## How it was counted

This is a **recording against the local stack**, not a count from the client code.

- Apple M4, 10 cores, 24 GiB, shared with two other agents, load average 4 to 12. Google Chrome headless at 1440 x 900.
- The stack ran under its own compose projects `sec050` and `sec050-zitadel`: Postgres with PgBouncer and MinIO from `compose.yaml`, the local Zitadel, the API under uvicorn and the web app on the **Vite dev server**, as `apps/e2e` starts them. A production build was not recorded, because the e2e build mode bundles the fake API. The dev server runs React in strict mode, which mounts screens twice, so the counts are likely an upper bound for production.
- Two specs drove the session, both signing in through the app's own sign-in page and making a fresh sample project and annotate task over three slides per round.
  - `apps/e2e/tests/main-paths.spec.ts` from TEST-019 (application performance on main paths) opens each slide by a page load, jumps to 10x and confirms two objects in the guided check.
  - The new `apps/e2e/tests/session-requests.spec.ts` does the same and also pans four drags and zooms four wheel steps on every slide. It runs with `PARFOCAL_SESSION_ROUNDS=6 PARFOCAL_SESSION_IDLE_SECONDS=0 pnpm exec playwright test tests/session-requests.spec.ts --workers=1`, skips itself when the variable is unset, and logs every `/api/` request the browser sends, for the route breakdown.
- Both run at the script's pace, as fast as the screens allow. No person works this fast, so these are measured upper bounds for one tab, not a human pace. A human pace was not measured.
- The **authoritative count** is the limiter's own `rate_counters` row for the test user, one per calendar minute. That is exactly what the limit is compared with. Only minutes that the run filled from start to end are counted as a rate, because a partial minute understates it. The recordings ran with both limits raised to 100000 so that no 429 cut them short.

## Results

| Spec | Per slide | Full minutes inside the run | Requests in that minute |
|---|---|---:|---:|
| `main-paths.spec.ts`, 16 rounds after a warm-up | open, jump, two decisions | 1 | **1,474** |
| `session-requests.spec.ts`, 6 rounds | the same plus pan and zoom | 1 | 643 |

- A round of three slides costs about 150 requests: the workspace counters of the main-paths runs read 143 to 149 per round. So 1,474 a minute is about 10 rounds, 30 slides opened and 60 decisions in one minute.
- The old limit of 600 is four rounds, which is where TEST-019 met 429.
- Per slide, the browser saw 27 answered requests on open, none on the jump, 1 while panning (`POST /api/auth/activity`) and 13 for two decisions. Panning and zooming call no API route, because tiles go to the edge and annotations load once per slide. The pan stretch only slows the script, which is why that spec's minute is lower.
- The busiest routes in the six session rounds were `GET .../check-status` (162 of 738 answered viewer requests), `GET .../shared-layer` (72) and `GET /api/review-tasks/{id}` (54). The route counts are in `apps/api/tests/fixtures/busy-viewer-session.json`.
- An idle slide with the guided check open made 27 requests in 60 s: 15 `POST .../coverage` and 12 `GET .../model-runs`.
- The browser saw 198 more viewer requests that never got an answer, one per route per page load, which looks like strict mode's first mount being cancelled. The server counted most of them, which is why the counter is used and not the browser log.

## The chosen limit

- `rate_limit_person_per_minute` is now **3,000**, about twice the fastest full minute measured, 1,474. One tab at script pace uses half of it, and a person would need about 20 rounds, 60 slides, in one minute to meet it.
- `rate_limit_tenant_per_minute` is now **12,000**, four people at the person limit, so that a few busy people in one workspace do not hit the workspace limit first.
- No route is exempt. Panning calls no API route, and an exempt route would be an unmetered path for a flood.
- A flood still meets the limit within seconds: the replay test below sends about 3,000 requests from one token in well under a minute.
- Production takes the new defaults on the next deploy. The deploy config sets neither variable.

## Tests

- `test_a_recorded_busy_session_stays_under_the_default_limit_and_a_flood_does_not` in `apps/api/tests/test_rate_limits.py` sends the fastest recorded full minute, 1,474 requests, inside one window under the default settings and gets no 429. It then keeps sending to 50 past the default limit in the same window and gets exactly 50 answers of 429.
- `test_the_default_limit_leaves_room_above_the_busiest_recorded_minute` fails if the person default drops below twice the recorded minute, or the workspace default below four people.
- `main-paths.spec.ts` ran 16 rounds at the new default with no 429. The Mac was busier then, load average up to 17, so its full minutes held only 659 to 907 requests, and the pytest replay is the stronger check.

## Open

- TODO: a human-paced count from pilot traffic, which ADR 0088 already asks for.
- `check-status` is called about 9 times per slide and is the cheapest place to cut requests if a lower limit is ever wanted.
