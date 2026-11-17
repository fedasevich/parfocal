# 0391. The session check reads in one statement and counts in the same transaction

- Date: 2026-11-17
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: OPS-030 (a warm API call answers in under 300 ms). Amends [ADR 0389](0389-session-checks-read-without-a-row-lock.md) (session checks read without a row lock and lock only to refresh)

## Context

On 2026-11-17 the two running `parfocal-api` containers ran on Azure `eu-west` and Azure `us-west`, because the web function has no region pin, while Neon runs in AWS `us-east-1`. A TCP connect from those containers to the Neon pooler took 89 ms and 60 ms ([result](../results/2026-11-17-warm-api-round-trips.md)). Every database round trip costs that much, so the number of round trips decides how slow a call is.

After ADR 0389 a normal signed-in call ran two transactions before the endpoint's own work. The first was the pool's ping, `BEGIN`, the scope, five reads (session, session policy, person, operator, membership) and `COMMIT`, 9 round trips. The second was the ping, `BEGIN`, the scope, the rate counter upsert and `COMMIT`, 5 more. Once a minute the `last_seen_at` touch added a third transaction of 5.

## Options

1. Keep the three transactions and accept 14 to 19 round trips per check.
2. Read the session, policy, person, operator and membership in one statement and run the touch and the counter upsert at the end of the same transaction when no refresh and no second factor are due. Keep ADR 0389's separate paths for those cases.
3. Keep the counters in memory per container. Modal runs several containers that scale to zero, so the limit would no longer hold across them.

## Decision

Option 2.

- One statement left-joins the session to its workspace's policy, the person and the membership and reads the operator flag with `EXISTS`. A session with no policy row uses the defaults, as before. `session_policies.tenant_id` is the primary key, so a session without an active workspace simply finds no row.
- When neither a refresh nor a second factor is due, the touch and the counter upsert run in the same transaction, upsert last, so the counter rows are locked from the upsert to the commit, one round trip, as in ADR 0389. A 429 is raised after the commit, so refused calls still count.
- A refresh still takes the `FOR UPDATE` path of ADR 0389, and a call that needs a second factor still records its use in its own transaction afterwards.

## Consequences

- A normal check goes from 14 round trips (19 once a minute) to 6 (8 once a minute) counted from the code: ping, `BEGIN`, scope, the read, the upsert and `COMMIT`. At 60 to 90 ms each that is about 0.5 to 0.7 s less per signed-in call. Members of a workspace without a second factor in their token still pay 3 more round trips for the workspace's two factor setting.
- The once a minute touch now locks the session row from its update to the commit, which is two round trips. A sibling call in the same minute waits that long and then skips the touch.
- `test_session_concurrency.py` now slows `read_session` instead of the removed `resolve`.
- Code alone does not reach 300 ms while the API and the database sit on different continents. Decision 140 in `docs/decisions.md` (moving the API and database to one region) holds the costed options.
