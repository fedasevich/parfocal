# Result: warm API calls are slow because the API containers run in Europe and the US west while Neon is in the US east, so every database round trip costs 60 to 90 ms

- Date: 2026-11-17
- Backlog: OPS-030 (a warm API call answers in under 300 ms)
- Kind: production measurement, partial. The "after" half waits for the deploy
- Commit: e70c6802 (Server-Timing) and the session check change after it, neither deployed when this was written
- Environment: MacBook on a home connection in Europe. app.parfocal.eu at v0.5.0, Modal app `parfocal-api` in environment `main`, Neon project `soft-pine-86468744` on its main branch
- Data: no session, so only unauthenticated routes were timed by curl. Signed-in times come from the owner's own measurement

## Question

Why does a warm signed-in call take seconds, and how much of it can code remove at no added cost?

## Method

- Neon's region came from its API (`describe_project`).
- The running containers' regions came from `modal container exec <id> -- env`, reading only `MODAL_REGION` and `MODAL_CLOUD_PROVIDER`.
- In each container a short Python loop timed five TCP connects to the Neon pooler host on port 5432. A connect is one network round trip. No credentials were used and nothing was written.
- curl timed ten calls in a row of `/api/status` and `/api/me` (401 with no session) with `time_starttransfer`.
- Round trips per signed-in check were counted from the code in `auth.py` and `parfocal_common.db`.

## Measurements

| What | Value |
|---|---|
| Neon region | `aws-us-east-1`, pooler `c-14.us-east-1.aws.neon.tech` |
| Container `ta-01M7MP53…` | Azure `eu-west`. TCP connect to Neon 108, 88.5, 88.9, 88.9, 90.7 ms |
| Container `ta-01M7MP34…` | Azure `us-west`. TCP connect to Neon 99.0, 60.2, 57.4, 64.5, 59.1 ms |
| `/api/status`, 10 calls at about 13:15 CET | 1.238, 1.325, 1.156, 1.977, 1.133, 1.440, 0.788, 1.452, 1.469, 0.886 s, median 1.28 s |
| `/api/me` with no session (401, no database), 10 calls | 0.317, 0.687, 0.359, 0.317, 0.687, 0.283, 0.628, 0.335, 0.588, 0.311 s, median 0.34 s |
| Owner's warm signed-in calls, one at a time, before this task | `/api/status` 0.95 s, `/api/me` 2.4 s, `/api/projects` 3.8 s, `/api/me/home` 7.5 s |
| Modal compute of `parfocal-api`, 1 to 17 November | $0.145 |

The 401 for `/api/me` touches no database and still costs about 0.34 s, which is the trip from Europe to the container and back. `/api/status` adds one transaction of one read, about 0.9 s more. That is the pool ping, which SQLAlchemy's asyncpg dialect runs as `BEGIN`, an empty statement and `ROLLBACK`, then `BEGIN`, the scope, the read, `COMMIT` and statement prepares, roughly 9 to 10 round trips of 60 to 90 ms by estimate. Any rest of the 0.9 s is unexplained.

## Round trips counted from the code

| Part of a signed-in call | Before | After |
|---|---|---|
| Session check, normal | about 18 | about 8 |
| Session check, once a minute with the `last_seen_at` touch | about 25 | about 9 |
| Session check for a member without a second factor in the token | add 3 | add 3 |
| Every transaction an endpoint opens | ping (3), `BEGIN`, scope and `COMMIT`, 6 plus its reads | unchanged |

These counts are estimates from the code, not measured. At 60 to 90 ms a round trip, the change saves about 0.6 to 0.9 s on every signed-in call. The pool ping is the largest fixed cost left, 3 of the 6 round trips every transaction pays. `/api/me/home` at 7.5 s is about 80 to 120 round trips, so it opens several transactions or reads in a loop. Server-Timing will show which.

## Server-Timing

Every answer now carries `Server-Timing: app;dur=…, db;dur=…, sql;dur=…, queries;desc="…", transactions;desc="…"`. `app` is the whole handler, `db` the time inside `scoped_transaction` (checkout, ping, `BEGIN`, queries, `COMMIT`), `sql` the time in statements only, so `db` minus `sql` is the transaction overhead. Where a route takes its connection from a dependency that commits after the answer starts, the header can miss that transaction, so the log line is the source for the slowest routes. The `request finished` log line carries the same numbers and the container's region, so `modal app logs parfocal-api -e main` shows them for real traffic.

TODO after the deploy of e70c6802: the ten slowest routes with their Server-Timing, read from the logs of a minute of clicking through home, projects and a review.

TODO after the deploy of the session check change: the same routes again, and the median of ten warm calls of `/api/me`, `/api/projects` and `/api/me/home`.

## Conclusion

Code cannot reach 300 ms while one round trip costs 60 to 90 ms. A signed-in call that only checks the session and reads one row needs about 15 round trips even after this change, which is 0.9 to 1.3 s of database time plus the 0.3 s trip to the container. Pinning the database functions to a narrow region beside Neon removes almost all of it for about $0.19 a month at today's use, and that is a spend change for the owner, written up in decision 140 of `docs/decisions.md` (moving the API and database to one region). The earlier [production latency result](2026-11-17-production-latency.md) said the database was close to the container. That held only for the one container it happened to measure.

## Not covered

- Signed-in routes, which need a session this agent may not create on the deployed app.
- N+1 reads in home, projects and review tasks. They wait for the Server-Timing numbers.
- Dropping or thinning the pool ping, which saves 3 round trips per transaction but needs care behind a pooler whose compute suspends. It is the next cut.
