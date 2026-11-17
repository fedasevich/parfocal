# Result: warm API calls on app.parfocal.eu spend 75 to 95 percent of their time on the Cloudflare to Modal hop, one web container serves one request at a time, and the first request each minute waits for an R2 write

- Date: 2026-11-17
- Backlog: TEST-019 (application performance on main paths)
- Kind: production measurement
- Commit: 61245cac plus the change in this commit, which is not deployed yet
- Environment: MacBook (Apple M4, 24 GB) on a home connection in Europe, Cloudflare answering from AMS. curl 8 with `-w` timing, one process per request unless noted. Production as deployed on 2026-11-13: Worker `parfocal-edge`, Modal app `parfocal-api` in environment `main` (deployed 2026-11-13 20:14 CET), Neon project `soft-pine-86468744`
- Data: no session, so only unauthenticated routes. No tile was reachable without a token, so tiles are measured only as the Worker's own 404 for `/tiles/x`

## Question

The owner sees bizarrely long load times on app.parfocal.eu even when the servers are warm. Where does the time go, and which part is code?

## Method

Each URL was fetched 5 times in a row within a minute with `curl -s -o /dev/null -w` reporting `time_namelookup`, `time_connect`, `time_appconnect`, `time_starttransfer` and `time_total`. Server-side times come from `modal app logs parfocal-api -e main`, which prints Modal's own `duration` and `execution` per request next to the app's `duration_ms` from `RequestLogging`. Configuration was read from `workers/deploy/src/parfocal_deploy/modal_app.py`, `packages/py-common/src/parfocal_common/db.py`, `apps/api/src/parfocal_api/auth.py`, `apps/edge/src` and the Neon API (`describe_project`, `list_postgres_endpoints`). Nothing in production was changed.

## Measurements

All times in milliseconds. Connect and TLS were 15 to 19 ms and 34 to 46 ms to Cloudflare on every request below, so the columns show time to first byte (TTFB) and total.

The web app from the Worker's static assets, 5 runs each at 01:07 UTC:

| URL | TTFB | Total | Size (brotli) |
|---|---|---|---|
| `/` | 95, 120, 90, 120, 79 | 95, 120, 91, 120, 79 | 1,567 B |
| `/assets/index-BUr8Hkbq.js` | 94, 102, 134, 97, 104 | 112, 121, 153, 116, 123 | 136,625 B |
| `/assets/react-CuOmR4mE.js` | 76, 73, 92, 71, 72 | 76, 73, 92, 71, 72 | 3,054 B |
| `/tiles/x` (Worker 404, no Modal) | 73, 65, 71, 83, 81 | same | 104 B |

The API through the Worker. The first `/api/health` run at 01:07:31 UTC was a cold start, the container list shows the only container started at 01:07:37:

| URL | Client TTFB, 5 runs | Modal duration (execution) | App `duration_ms` |
|---|---|---|---|
| `/api/health` at 01:07:31, cold then warm | 5,705, 471, 483, 180, 525 | 5,240 (9.5), 26 (8.3), 31 (9.9), 35 (10.6), 35 (8.6) | 0.3 to 1.1 |
| `/api/health` at 01:08:29 | 521, 573, 459, 165, 177 | 616 (592), 94 (7.7), 28 (8.7), 24 (7.0), 29 (10.3) | 0.4 |
| `/api/status` at 01:09:33, one maintenance read on Neon | 600, 531, 487, 547, 491 | 545 (523), 66 (29), 53 (25), 62 (36), 53 (24) | not logged |
| `/api/me` at 01:09:36, 401 with no session | 1,044, 201, 209, 198, 481 | 601 (582), 28 (10), 39 (10), 36 (11), 42 (12) | not logged |

Server lines were matched to the client runs by their timestamps from `modal app logs --timestamps` (Modal prints CET, one hour ahead). The first request of each set falls in a new minute, and that is the one with 480 to 590 ms of execution. At 01:11:32 the same happened again: health 497 (477), followed by 374 (8.4), a request that waited for the container while it was still busy with the one before. The client total of the first request can be shorter than Modal's duration (521 against 616), so the response leaves before Modal counts the request as done.

The Modal origin directly, without the proxy token, so Modal refuses with 401 before any container: connect 105 to 125, TLS done at 211 to 233, TTFB 322 to 343 over 5 runs. One round trip from this Mac to `modal.run` is therefore about 110 ms, which points at a US ingress.

One curl process reusing its connection, 5 requests each, at 01:11 UTC: `/api/health` 199, 480, 153, 140, 443 and `/api/status` 215, 164, 170, 168, 161. The spread stays bimodal on one client connection, so the slow half is on the Worker to Modal hop.

8 parallel `/api/status` requests at 01:11 UTC finished at 189, 221, 248, 471, 505, 534, 564 and 598 ms. Modal logged execution of 23 to 26 ms each but duration rising from 43 to 141 ms, and `modal container list -e main` showed one container. The requests queued behind each other.

Earlier logs from 00:44 UTC, from the owner's own browser, show waits at a larger scale: `/api/me/checklist` duration 2.80 s with execution 133 ms and `/api/status` duration 2.92 s with execution 105 ms. Whether they queued behind other requests or behind a container start is not visible in the logs. In the same minute a `/api/rooms/{room}/access` 401 took 756 ms of app time, which stays unexplained.

Neon, read through its API: region `aws-us-east-1`, Free plan (`free_v3`), compute fixed at 0.25 CU, `suspend_timeout_seconds` 0, which means the plan default of 5 minutes and cannot be turned off on Free. The compute's `started_at` was 01:07:37 UTC, the same second as the cold container, because the API's startup checks the database role. This month so far: 9,020 compute seconds (2.5 CU-hours of the 100 included) and 35,860 active seconds.

Static asset headers: every hashed file under `/assets/` was served with `cache-control: public, max-age=0, must-revalidate`, and `/` lists 77 `modulepreload` links and 80 `/assets/` references in all.

## Where the time goes

- A warm `/api/health` costs the app under 1 ms, Modal 25 to 35 ms, and the client 140 to 570 ms. The rest is the trip from Cloudflare in Amsterdam to Modal's ingress in the US and back. Inferred, not observed: the fast group near 150 to 200 ms fits one round trip of about 110 ms on a reused connection, and the slow group near 450 to 600 ms fits about four round trips (TCP, TLS and the request), which suggests the Worker often opens a new connection to Modal. Cloudflare does not show this per request.
- A warm `/api/status`, one small query, runs 24 to 36 ms inside the container, so the database is close to the container and is not the warm bottleneck.
- The first request in each new minute ran 480 to 590 ms longer inside Modal while the app logged under 1 ms. `SliMiddleware` sits outside `RequestLogging` and, after every request, awaited `SliEmitter.flush_if_due()`, which writes the closed minute's SLI batch to R2 (and flushes telemetry) once a minute has passed. So the first request of each minute carried an R2 write from the US container, and because the container takes one request at a time, the next request waited for it too. The 401 for `/api/me` at 01:09:36 also spiked in a minute that had already flushed at 01:09:33. That one is not located.
- The web function has no input concurrency setting, so Modal sends one request at a time to a container. The app's page loads fire several API calls at once, so they queue, and once the queue grows Modal may start another container, which costs about 5.2 s of cold start. It likely explains why one open tab kept four containers alive on 2026-11-13, though that is inferred.
- A cold start costs about 5.7 s at the client: 5.24 s of container start including the Neon wake, then the transatlantic hop.
- The web container has no `cpu` setting, which on Modal means 0.125 of a core. With up to 10 requests now sharing one container, that core and the 2,048 MiB memory ceiling are shared too, and a blocking call in one handler stalls the rest, so the `cpu` row below matters more after this change.
- Authenticated requests could not be measured without a session. Reading `authenticate` shows 8 to 11 sequential statements in one transaction per request (session row with `FOR UPDATE`, session policy, user, operator, membership, an optional second-factor read and a rate counter upsert), before the endpoint opens its own transaction. With 24 to 36 ms for one statement plus transaction overhead in `/api/status`, that is likely 60 to 120 ms of server time per authenticated call, and the `FOR UPDATE` on the session row makes parallel calls from one browser take turns. TODO: measure with a session.
- Static files come from Cloudflare in 70 to 150 ms, but because hashed chunks were marked `max-age=0, must-revalidate`, every repeat visit revalidated all of them.

## Changes in this commit

- The Modal web function now takes up to 10 requests at once (`modal.concurrent(max_inputs=10, target_inputs=8)`), so one warm container serves a page's parallel calls instead of queueing them or cold-starting more containers. Tested in `workers/deploy/tests/test_modal_app.py`.
- The database pool is now 10 connections plus 10 overflow, so 10 concurrent requests that each hold two connections still fit. Tested in `packages/py-common/tests/test_db_engine.py`.
- The Worker serves files under `/assets/` that answer 200 and are not HTML with `Cache-Control: public, max-age=31536000, immutable`. The single page fallback for a missing chunk stays `no-store`. Tested in `apps/edge/test/security-headers.test.ts`.

- The SLI batch now flushes in a background task (`SliEmitter.flush_soon_if_due`), at most one at a time, so no request waits for the R2 write. Shutdown waits for it with `settle()` before the last flush. The realtime publisher uses the same call. Tested in `packages/py-common/tests/test_sli_store.py`.

These take effect at the next deploy. TODO: repeat this run after it. The check is that 8 parallel `/api/status` calls show flat Modal durations on one container and that no request at the start of a minute runs 500 ms of execution.

## Production settings to consider

Rates come from [platform.md](../knowledge/platform.md) (Modal at $0.0000131 per core-second and $0.00000222 per GiB-second) and the Neon pricing page read on 2026-11-17 (Launch at $0.106 per CU-hour). The budgets in `costs.py` already add up to $30, so anything here needs money moved from another line.

| Change | Effect | Monthly cost |
|---|---|---|
| `min_containers=1` on the web function | Removes the 5.2 s cold start, but not the transatlantic hop | 0.125 core and 0.5 GiB always on is about $0.0099 an hour, about $7.20 a month |
| Keep one container warm only in working hours, for example a scheduled `update_autoscaler(min_containers=1)` from 08:00 to 18:00 on weekdays | Same, for the hours that matter | About 220 hours, about $2.20 a month |
| `cpu=0.5` on the web function | Faster Python under load | Only while warm. 60 warm hours a month cost about $1.05 more than today |
| Neon Launch plan with scale to zero off | Removes the Neon wake on a cold start | 0.25 CU for 730 hours is 182.5 CU-hours, about $19.35 a month. Not recommended within $30 |
| Move Modal and Neon to Europe together | Removes about 110 ms per call for European users, and up to 450 ms when the Worker opens a new connection | Modal region `eu` costs 1.15 times its compute. Neon needs a new project in an EU region and a reseed, which [ADR 0293](../adr/0293-production-only-until-the-first-real-user.md) (production only until the first real user) allows. Moving only Modal would make every query cross the Atlantic, so never do one without the other. TODO: confirm that `modal.run` ingress moves with the function region |

## Not covered

- Authenticated home, project and review pages, which need a session.
- Tiles from R2, which need a token.
- Where exactly the Worker loses its connection to Modal. Cloudflare does not expose that per request.
