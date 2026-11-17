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

## After, deployed

TODO after the lead deploys this branch: ten warm calls each of `/api/me/home`, `/api/me/notification-preferences` and `/api/me/review-tasks` with `time_starttransfer` and Server-Timing, and the log lines grouped by `container` and `cloud`.

## What this means

- The slow containers lose their time on the network path to the database: 120 to 180 ms per query and 340 to 580 ms per transaction against 15 to 25 ms and 60 to 80 ms on fast ones, with CPU time equal. The region label does not separate them, since fast and slow containers both say `eu-west`. Modal's `eu` regions span several clouds, and the next log lines will show whether the slow ones share one provider. If they do, pinning the web function to that provider's Frankfurt region or excluding the slow one is the fix, and it may carry Modal's price multiplier for narrow regions, which is the owner's call.
- On a fast container home at 59 queries took 1.1 s. At about 14 queries plus the session check and without the pre-ping it should land near 0.3 to 0.4 s on a fast container, an estimate from the per-query cost, not measured.

## Not covered

- The slide open path. `/api/slides/{slide_id}/tile-access` took 0.47 to 1.01 s with 11 to 14 queries in the same logs, so it is not the 10 s wait. The rest of the path (`levels.json`, the range reads of `original.tif` through the edge Worker) needs a signed-in browser and stays open in OPS-033.
- The cloud of the slow containers, which had stopped before this reading.
