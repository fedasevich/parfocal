# Result: every API transaction paid three round trips of frame, and one simple query cuts it to two

- Date: 2026-11-18
- Backlog: OPS-030 (a warm API call answers in under 300 ms)
- Kind: local measurement. The deployed app could not be reached from this session (the agent proxy refused `app.parfocal.eu`, no Modal CLI and no agent test account), so the deployed medians are still open
- Commit: the OPS-030 commit of 2026-11-18 that adds [ADR 0400](../adr/0400-a-transaction-begins-and-sets-its-scope-in-one-round-trip.md) (a transaction begins and sets its scope in one round trip)
- Environment: shared Linux container, local `compose.yaml` stack (Postgres 18 with PostGIS, PgBouncer in transaction mode), API in process through the signed-in test browser (`signed_in_browser`, real session check), Python 3.14

## Question

How many database round trips does a warm signed-in call make, which of them are fixed cost, and how many can code remove?

## Method

- A small asyncio TCP proxy sat between the API and PgBouncer and delayed every chunk the API sent by a set time, so each round trip costs that time on top of local work. It also logged the Postgres message types of each chunk (`Q` simple query, `B E S` bind, execute, sync) with the SQL text of simple queries.
- A throwaway probe test signed in, entered a one-factor workspace as a researcher who owns three projects, called each route three times to warm up, then ten times, and recorded wall time and Server-Timing. Medians below. One more call per route was traced on the wire.
- Two runs per code version, with 0 ms and 20 ms added. Before is the tree at `5104c1ce`, after is the change.
- The probe and the proxy were not committed. `test_db_round_trips.py` keeps the round-trip count as a test.

## Wire trace of one warm call, before

`/api/me`: `BEGIN`, scope, session read, `COMMIT`, `BEGIN`, scope, two handler reads, `COMMIT`. Nine round trips for three statements of real work. Every transaction is `BEGIN` alone, the prepared scope statement, its reads and `COMMIT`. Prepared statements are cached, so a warm statement is one round trip and the pool ping does not run on calls less than 30 s apart.

| Route | Round trips before | After | Queries in Server-Timing |
|---|---|---|---|
| `/api/me` | 9 | 7 | 5 |
| `/api/projects` | 10 | 8 | 6 |
| `/api/me/home` (owner of three projects, no tasks) | 12 | 10 | 8 |
| `/api/tenant` | 8 | 6 | 4 |

## Medians of ten warm calls (ms)

| Route | Before, 0 ms added | Before, 20 ms added | After, 0 ms added | After, 20 ms added |
|---|---|---|---|---|
| `/api/me` wall | 9.4 | 217.6 | 6.9 | 183.8 |
| `/api/me` db | 6.8 | 209.0 | 5.0 | 179.6 |
| `/api/projects` wall | 8.0 | 242.9 | 7.7 | 182.1 |
| `/api/projects` db | 6.7 | 241.1 | 6.3 | 178.6 |
| `/api/me/home` wall | 21.0 | 351.8 | 15.0 | 304.4 |
| `/api/me/home` db | 17.9 | 346.9 | 13.1 | 267.4 |
| `/api/tenant` wall | 6.6 | 209.3 | 5.9 | 146.7 |
| `/api/tenant` db | 4.6 | 202.9 | 4.1 | 140.1 |

At 20 ms a round trip the change saves 34 to 80 ms per call, about the two round trips the trace shows plus noise from a shared machine. Local work without added delay is 5 to 21 ms, so on the deployed app nearly all of a warm call's database time is round trips times the distance from the container to Neon.

## What it means for the deployed app

The owner's v0.17.6 medians were `/api/me` 244 ms (db 38 ms), `/api/projects` 262 ms (db 226 ms) and `/api/me/home` 433 ms (db 99 ms). Two round trips fewer per call is worth 2 times the container's round trip to Neon, about 20 ms from the Azure container and about 55 ms from the AWS one, taking the db time of `/api/me` measured per cloud on v0.17.4 (83 and 243 ms, [region options result](2026-11-17-server-region-options.md)) over its nine round trips. This is an estimate, not a measurement. Home's gap to `/api/me` in the browser (about 190 ms) is larger than its extra db time (about 60 ms), so part of home's time is outside the database, which only a deployed Server-Timing `app` value next to the browser time can show.

TODO: after the deploy, ten warm calls each of `/api/me`, `/api/projects` and `/api/me/home` in a signed-in browser with Server-Timing, and the ten slowest routes again.

## Not covered

- The deployed app. Blocked in this session as said above.
- A home for a reviewer and adjudicator with tasks, which runs more statements than this probe's owner.
- Reading home's statements in parallel on two connections, which would save about three more round trips at the cost of a second pooled connection per call.
