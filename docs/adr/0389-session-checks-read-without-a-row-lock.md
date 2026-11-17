# 0389. Session checks read without a row lock and lock only to refresh

- Date: 2026-11-17
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: IAM-031 (requests from one session run in parallel)

## Context

On 2026-11-17 production answered 20 parallel calls from one signed-in browser one after another in 17 s, while 20 calls without a cookie took 0.8 s. `authenticate` read the session row with `SELECT ... FOR UPDATE` and held that lock through the session policy, membership, second factor and rate counter queries, each a round trip to the database, and across a Zitadel refresh when the access token neared expiry. The rate counter upsert ran in the same transaction, as [ADR 0088](0088-rate-limits-in-postgres-and-at-the-edge.md) (rate limits counted in Postgres by the API) chose, so it also held one counter row per person and per workspace until the end. No ADR had recorded the session row lock itself. It came with the first login in [ADR 0025](0025-zitadel-bff-login.md) (login through the backend with server-side refresh).

## Options

1. Keep the lock and make each query cheaper. Every request of a session still waits for the one before it, so 20 calls still cost 20 times one.
2. Read the session without a lock and lock only to refresh. Concurrent requests wait on each other only while one of them refreshes.
3. Keep the tokens in memory per container. The API runs as several Modal containers that scale to zero, so a rotated refresh token would be lost between them.

## Decision

Option 2.

- The session check reads the session row, the policy, the person, the membership and the second factor setting in one transaction with no lock. The lifetime and idle lock checks run on that read.
- When the access token is within 30 seconds of expiry, a second short transaction takes `FOR UPDATE` on the session row, checks again that a refresh is still due and only then calls Zitadel. A request that waited for another one's refresh finds the new expiry and skips it, so racing requests refresh once and never spend the rotated refresh token twice. A refused refresh still deletes the session.
- The rate counters and the once a minute `last_seen_at` touch run last, in their own short transaction. The touch is a plain conditional update, so a second request in the same minute skips it.

## Consequences

- 20 parallel calls of one session against the local stack, with 0.5 s of simulated database latency per check, take 1.1 s instead of 20 times one call. `test_session_concurrency.py` holds that to under three times one call and checks that racing calls near expiry refresh once.
- A normal request opens two short transactions instead of one, which costs a few more round trips but never waits on a sibling request. Requests that need neither a counter nor a touch, such as an operator's, open only one.
- Refused requests still count toward the limit, as they did before this change.
