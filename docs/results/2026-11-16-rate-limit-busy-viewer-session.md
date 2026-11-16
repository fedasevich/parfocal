# Result: a busy viewer session makes up to 643 API requests in a calendar minute

- Date: 2026-11-16
- Backlog: SEC-050 (the per-person rate limit fits a real viewer session)
- ADR: [0088](../adr/0088-rate-limits-in-postgres-and-at-the-edge.md) (rate limits in Postgres and at the edge), whose defaults this changes

## Question

How many API requests does one person's busy viewer session make per minute, and what per-person limit keeps that session clear of 429 while a flooding script still gets it?

## How it was counted

This is a **recording against the local stack**, not a count from the client code.

- Apple M4, 10 cores, 24 GiB, shared with two other agents, load average 4 to 12. Google Chrome headless at 1440 x 900.
- The stack ran under its own compose projects `sec050` and `sec050-zitadel`: Postgres with PgBouncer and MinIO from `compose.yaml`, the local Zitadel, the API under uvicorn and the web app on the **Vite dev server**, as `apps/e2e` starts them. A production build was not recorded, because the e2e build mode bundles the fake API. The dev server runs React in strict mode, which mounts screens twice, so the counts are likely an upper bound for production.
- The spec is `apps/e2e/tests/session-requests.spec.ts`, run with `PARFOCAL_SESSION_ROUNDS=6 PARFOCAL_SESSION_IDLE_SECONDS=0 pnpm exec playwright test tests/session-requests.spec.ts --workers=1`, with both limits raised to 100000 so that no 429 cut the session short. It skips itself when the variable is unset. It signs in through the app's own sign-in page, and each round makes a fresh sample project and annotate task over three slides, as the TEST-019 (application performance on main paths) spec does. For every slide it opens the slide by a page load, jumps to 10x, pans four drags and zooms four wheel steps, and confirms two objects in the guided check.
- The pace is the script's, as fast as the screens allow, about 5 s per slide. No person works this fast, so this is a measured upper bound for one tab, not a human pace. A human pace was not measured.
- The **authoritative count** is the limiter's own `rate_counters` row for the test user, one per calendar minute, read at the end of the run. That is exactly what the limit is compared with. The spec also logs every `/api/` request the browser sends, for the route breakdown.

## Results

| Run | Rounds | Idle stretch | Busiest calendar minute |
|---|---:|---:|---:|
| 1 | 4 | 60 s on the first slide | 414 |
| 2 | 6 | none | 635 |
| 3 | 6 | none | 643 |
| 4 | 6 | none | 612 |
| `main-paths.spec.ts`, 7 rounds, at the new default | 7 | none | 651 |

- So a busy session at machine pace makes **612 to 651** requests in its busiest calendar minute, above the old limit of 600. That is the 429 TEST-019 met after about four rounds.
- Per slide, the browser saw 27 answered requests on open, none on the jump, 1 while panning (`POST /api/auth/activity`) and 13 for two decisions. Panning and zooming call no API route, because tiles go to the edge and annotations load once per slide.
- The busiest routes in run 4 were `GET .../check-status` (162 of 738 answered viewer requests), `GET .../shared-layer` (72) and `GET /api/review-tasks/{id}` (54). The route counts are in `apps/api/tests/fixtures/busy-viewer-session.json`.
- An idle slide with the guided check open made 27 requests in 60 s: 15 `POST .../coverage` and 12 `GET .../model-runs`.
- The browser saw 198 more viewer requests that never got an answer, one per route per page load, which looks like strict mode's first mount being cancelled. The server counted most of them, which is why the counter is used and not the browser log.

## The chosen limit

- `rate_limit_person_per_minute` is now **1,500**, about 2.3 times the busiest measured minute, so even two tabs at machine pace stay under it.
- `rate_limit_tenant_per_minute` is now **6,000**, four people at the person limit, so that two or three busy people in one workspace do not hit the workspace limit first.
- No route is exempt. Panning calls no API route, and an exempt route would be an unmetered path for a flood.
- Production takes the new defaults on the next deploy. The deploy config sets neither variable.

## Tests

- `test_a_recorded_busy_session_stays_under_the_default_limit_and_a_flood_does_not` in `apps/api/tests/test_rate_limits.py` sends the busiest recorded minute, 643 requests, inside one window under the default settings and gets no 429. It then keeps sending to 50 past the default limit in the same window and gets exactly 50 answers of 429. On this machine the 1,550 requests took 4.75 s.
- `test_the_default_limit_leaves_room_above_the_busiest_recorded_minute` fails if the defaults drop below twice the recorded minute, or the workspace limit below four people.
- `main-paths.spec.ts` ran 7 rounds at the new default with no 429 (651 requests in its busiest minute).

## Open

- TODO: a human-paced count from pilot traffic, which ADR 0088 already asks for.
- `check-status` is called about 9 times per slide and is the cheapest place to cut requests if a lower limit is ever wanted.
