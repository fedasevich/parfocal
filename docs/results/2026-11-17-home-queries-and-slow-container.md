# Result: home, notification preferences and my review tasks drop to a fixed handful of queries, and the slow web containers lose time on the database network path, not on CPU

- Date: 2026-11-17
- Backlog: OPS-033 (home under 500 ms and a slide opens in under 3 s on the deployed app)
- Kind: production log reading and local db tests. The deployed "after" waits for the lead's deploy
- Commit: the OPS-033 branch, `perf(OPS-033): Batch home and my-work reads and ping only idle pool connections` and the result commit after it
- Environment: Modal app `parfocal-api` in `main`, web function `fu-2SBrsUU6fc5rWpDzG8E8F1` (EU pinned since OPS-031, the move to the EU), Neon project `still-field-25034761` in `aws-eu-central-1`. Local tests on the compose Postgres
- Data: the request log lines of real traffic from 13:30 to 15:03 UTC, read with `modal app logs parfocal-api -e main --search "request finished" --show-container-id --show-function-id`. No session was created for this measurement

## Question

Why do home and the two "me" lists run tens of queries, and why is one web container about 7 times slower than another?

## Before, deployed, from the log lines

Medians per route and container after the EU move. `sql/q` is SQL time divided by queries, `overhead/tx` is transaction time outside SQL (checkout, pre-ping, `BEGIN`, `COMMIT`) per transaction.

| Route | Container | Region | Calls | App ms | Queries | sql/q ms | overhead/tx ms |
|---|---|---|---|---|---|---|---|
| `/api/me/home` | `…5QZBVR` | eu-west | 11 | 1,122.9 | 59 | 17.8 | 79.2 |
| `/api/me/home` | `…CKZQ5R` | eu-north | 5 | 2,229.4 | 59 | 33.0 | 111.8 |
| `/api/me/home` | `…YABZ6R` | eu-west | 3 | 6,162.2 | 36 | 148.9 | 372.4 |
| `/api/me/notification-preferences` | `…5QZBVR` | eu-west | 11 | 579.4 | 29 | 16.0 | 66.2 |
| `/api/me/notification-preferences` | `…Y5DZ0R` | eu-west | 1 | 4,799.3 | 30 | 121.5 | 575.4 |
| `/api/me/review-tasks` | `…5QZBVR` | eu-west | 15 | 618.7 | 32 | 15.4 | 69.7 |
| `/api/me/review-tasks` | `…YABZ6R` | eu-west | 4 | 3,636.9 | 16 | 177.1 | 400.1 |
| `/api/status` | `…5QZBVR` | eu-west | 14 | 106.9 | 2 | 23.1 | 59.4 |
| `/api/status` | `…Y5DZ0R` | eu-west | 5 | 758.9 | 2 | 167.8 | 422.5 |
| `/api/status` | `…YABZ6R` | eu-west | 12 | 645.9 | 2 | 127.0 | 337.0 |

Every container of the EU function, by start time, with the median SQL time per query over all its requests:

| Container | Region | First and last request (UTC) | Requests | sql/q ms |
|---|---|---|---|---|
| `…YABZ6R` | eu-west | 14:14 to 14:20 | 82 | 143.2 |
| `…SEBB9R` | eu-west | 14:14 to 14:20 | 41 | 157.0 |
| `…5QZBVR` | eu-west | 14:21 to 14:58 | 351 | 18.6 |
| `…Y5DZ0R` | eu-west | 14:21 to 14:29 | 29 | 164.6 |
| `…CKZQ5R` | eu-north | 14:30 to 14:45 | 125 | 32.1 |
| `…1RZ50R` | eu-north | 14:59 to 15:03 | 19 | 38.3 |
| `…FWZ8JR` | eu-west | 14:59 to 15:01 | 30 | 25.9 |

`…5QZBVR` and `…Y5DZ0R` started within one second of each other, from the same function and region label, and differ 8.9 times in SQL time per query.

Handler time outside the database (app minus db) is 1.8 to 3.4 ms at the median on every container, slow ones included, so CPU is not the cause.

The two containers still running at 15:05 UTC, read with `modal container exec … printenv` and five TCP connects each to the Neon pooler host (no credentials):

| Container | `MODAL_REGION` | `MODAL_CLOUD_PROVIDER` | TCP connect ms |
|---|---|---|---|
| `…FWZ8JR` | eu-west | GCP | 37.9, 14.1, 15.0, 16.7, 13.8 |
| `…1RZ50R` | eu-north | Azure | 73.5, 22.0, 23.7, 25.4, 23.0 |

## Why the queries piled up

- `/api/me/notification-preferences` read the preference table once per notification kind.
- `/api/me/review-tasks` ran `states_of` per task, which reads the task's slides, its whole disagreement queue (5 queries) and its assignments, only to learn the member's own assignments.
- `/api/me/home` ran 4 queries per project card and the full disagreement queue per open task in projects the member adjudicates.

## Change

- Preferences are one query. My review tasks read the member's assignments and "has work" flags for all tasks in one query.
- The disagreement queue is built by `queues_of` for many tasks in 5 queries, and `queue_of` calls it for one.
- Home builds all project cards in 3 queries (members as a subquery, slide, reviewed and result set counts grouped by project, the 4-slide strip by `row_number()`), reads the week in one query and the slide line of the resume target in one.
- The pool no longer pre-pings on every checkout. A connection is pinged only when it sat idle for 30 s or more, so a burst of requests pays no ping. The pre-ping cost 3 round trips (`BEGIN`, `;`, `ROLLBACK`) per transaction. Neon suspends after 5 minutes without activity (`suspend_timeout_seconds` 0, the plan default), so a connection used in the last 30 s cannot point at a suspended compute. The cost: a connection the server drops for another reason within 30 s of its last use fails one request, after which SQLAlchemy invalidates the pool.
- The request log line carries `cloud` (`MODAL_CLOUD_PROVIDER`) and `container` (`MODAL_TASK_ID`) beside `region`.

## After, local

Queries per call from the test client on the compose Postgres, measured by `test_query_counts.py`. The test harness skips the real session check, which adds its own transaction on the deployed app, so these are not the deployed counts.

| Route | One task, one project | Four tasks, four projects |
|---|---|---|
| `/api/me/home` as owner | 14 | 14 |
| `/api/me/home` as reviewer | 14 | 14 |
| `/api/me/review-tasks` as reviewer | 5 | 5 |
| `/api/me/review-tasks` as owner, no tasks | 3 | 3 |
| `/api/me/notification-preferences` | 3 | 3 |

Before the change a first version of the same test measured home at 41 (owner) and 53 (reviewer) queries and review tasks at 28 with four tasks and four projects, against 14, 20 and 7 with one task and one project.

## After, deployed v0.10.0

The owner's browser after two loads: `/api/me/home` 26 queries and 449 ms of database time (was 59 and 2,429 ms), `/api/me/notification-preferences` 10 and 228 ms (was 29 and 926 ms), `/api/me/review-tasks` 11 and 319 ms (was 32 and 835 ms).

Curl from the owner's Mac at about 15:30 UTC with a scratch session for the seeded `seed:ada@showcase.invalid`, minted by a scratch Modal run in `main` with the app's own session key (4 hours, `amr` with `mfa`). Calls in a row on one kept-alive connection:

| Route | First byte (s) | Server-Timing `app` (ms) | `sql` (ms) | Queries, transactions |
|---|---|---|---|---|
| `/api/me`, 8 calls | 0.68, 0.45, 0.45, 0.43, 0.43, 0.52, 0.35, 0.47 | 273, 215, 218, 219, 219, 144, 138, 146 | 99 to 117 | 6 (7 on the first), 2 |
| `/api/me/home`, 6 calls | 1.11, 0.79, 0.67, 0.53, 0.52, 0.40 | 406, 523, 455, 403, 406, 289 | 243 to 474 | 17, 2 |
| `/api/me/slides`, 1 call | 1.40 | 1,181 | 1,079 | 70, 2 |

`/api/me/slides` (the slides page) still reads per slide and is the next N+1 to batch.

## The per-request floor

Every signed-in call ran 9 statements before this change when the member signed in with a password only: the session check's scope and read, 3 statements for the workspace's two factor setting, the rate counter upsert, then the handler's scope and the workspace status. [ADR 0393](../adr/0393-the-session-check-reads-the-two-factor-setting-and-counts-in-batches.md) (the session check reads the two factor setting and counts in batches) joins the setting into the one read and writes rate counts in batches. `test_session_check_queries.py` on the compose Postgres pins `/api/tenant` for a password-only member at 5 statements in 2 transactions on warm calls and 6 on the first call of a minute. On a fast container at 17 to 25 ms a statement that is about 80 to 100 ms less per call, an estimate, not measured. Not deployed.

Left for the floor: the check and the handler still run in 2 transactions, which costs `BEGIN`, `COMMIT` and a scope statement more, about 40 to 110 ms on the deployed `/api/me` (`db` minus `sql`).

## Where the time outside the handler goes

Modal's own request lines (`modal app logs --source system`) give `duration` at Modal's entry and `execution` in the container, 1,819 requests from 12:30 to 15:18 UTC:

- Warm containers: the gap between the two is 79 ms at the median and 200 ms at the 90th percentile.
- New containers: the first requests wait 1.0 to 2.8 s at Modal's entry while the container restores from its memory snapshot (`…4SQ1AR` 1,399 to 1,509 ms, `…X60NPR` 1,420 to 1,430 ms, `…BFVH0R` 1,110 to 2,151 ms, `…M4SXSR` 2,580 to 3,245 ms). Their first execution adds 0.7 to 1.3 s outside the database, for example 1,763 ms with 426 ms of database time on `…4SQ1AR`.
- New containers start inside one page load. `…4SQ1AR` started at 15:16:16 while `…5VQRRR` from 15:15:38 was running, during a page that sends about 12 calls at once, above the `target_inputs` of 8.

From the Mac, `/api/health` through the edge answers in 0.15 to 0.18 s on a kept-alive connection, and the Modal address directly in 0.10 to 0.11 s. A new connection adds 0.1 to 0.5 s of TCP and TLS on the Mac's network. The Worker adds about 50 ms.

So the 2 s calls with 0.3 to 0.5 s of database time are cold containers, started on a page burst or after 5 idle minutes. The change raises `max_inputs` to 20 and `target_inputs` to 16 and the pool overflow to 30, so one page load fits in one container. Not deployed.

## The slide open of test_065

`test_065` is a Philips TIFF of 77,824 by 53,760 pixels in 9 levels, 428 MiB. Curl from the Mac:

| Step | First byte (s) |
|---|---|
| `tile-access` | 0.81, 1.08, 1.12 (`app` 372 to 497 ms, 11 queries) |
| `levels.json` | 0.29 |
| 64 KiB ranges of `original.tif` | 0.23 to 0.37 |

The viewer reads the TIFF in 1 MiB blocks and follows the directory chain one directory at a time. A script that walks the chain the same way through the edge read 9 blocks one after another (blocks 0, 294, 295, 386, 387, 416, 424, 426 and 427):

| Run | Walk (s) | Per block (s) | Edge cache |
|---|---|---|---|
| First | 4.84 | 1.27, 1.18, 0.64, 0.20, 0.23, 0.33, 0.31, 0.38, 0.31 | not read |
| Second | 4.18 | 1.73, 0.52, 0.34, … | not read |
| Third | 2.61 | 0.19 to 0.43 | hit on all 9, 9 to 31 ms in the Worker |

The Worker's range cache works. The biggest wait is the serial directory walk, 2.6 to 4.8 s from the Mac before the first tile, on top of `tile-access`. Writing each level's directory offset into `levels.json` at ingest would let the viewer read all 9 blocks at once. That is an ingest, backfill and viewer change, so it is a new backlog task, not done here. The browser's own waterfall was not read, so client work and the tiles after the walk are not measured.

## What this means

- The slow containers lose their time on the network path to the database: 120 to 180 ms per query and 340 to 580 ms per transaction against 15 to 25 ms and 60 to 80 ms on fast ones, with CPU time equal. The region label does not separate them, since fast and slow containers both say `eu-west`. Modal's `eu` regions span several clouds, and the next log lines will show whether the slow ones share one provider. If they do, pinning the web function to that provider's Frankfurt region or excluding the slow one is the fix, and it may carry Modal's price multiplier for narrow regions, which is the owner's call.
- On a fast container home at 59 queries took 1.1 s. At about 14 queries plus the session check and without the pre-ping it should land near 0.3 to 0.4 s on a fast container, an estimate from the per-query cost, not measured.

## Not covered

- The slide open in a browser. The curl and script numbers above cover the network path only.
- The cloud of the slow containers, which had stopped before this reading.
- The deployed effect of ADR 0393 and the new concurrency. TODO after the lead deploys: ten warm calls of `/api/me` and `/api/tenant` with Server-Timing, and the first-request gaps of new containers in Modal's system lines.
