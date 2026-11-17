# 0393. The session check reads the two factor setting in its one statement and counts calls in batches

- Date: 2026-11-17
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: OPS-033 (home under 500 ms and a slide opens in under 3 s on the deployed app). Amends [ADR 0391](0391-the-session-check-reads-in-one-statement-and-counts-in-the-same-transaction.md) (the session check reads in one statement and counts in the same transaction)

## Context

After ADR 0391 and v0.10.0 the owner's browser still showed 9 queries in 2 transactions on every signed-in call. The seeded members sign in with a password only, so the check ran ADR 0391's read and then 3 more statements for the workspace's two factor setting (set the tenant scope, read `workspace_settings`, set the auth scope back), because `workspace_settings` is visible only in its own tenant's scope. It then upserted the two rate counters on every call. That is 6 statements in the check plus 3 in the handler, about 20 ms each on a fast container ([result](../results/2026-11-17-home-queries-and-slow-container.md)).

## Options

1. Keep the separate two factor read and the upsert on every call.
2. Let the auth scope read `workspace_settings`, the way it already reads `session_policies`, and join it into the one statement. Count calls in memory per container and write them to `rate_counters` in batches.
3. Cache the two factor setting per container for a minute. A workspace that turns the setting on would still accept one factor for up to a minute on every container.

## Decision

Option 2.

- Migration 0136 (the auth scope reads workspace settings) adds an `auth_read` select policy on `workspace_settings`, the same as on `session_policies`. The session statement left-joins it on the active workspace.
- Each container keeps a count per rate key and minute. It writes the count with one upsert that adds the batch, at the first call of a minute, when its unwritten count reaches a twentieth of the limit, and on every call once its last known total plus its unwritten count passes half the limit. The upsert returns the shared total, so a 429 still follows the count of all containers.
- The touch and the upsert still run at the end of the check's own transaction, as in ADR 0391. Service tokens and report links keep the exact count on every call.

## Consequences

- A warm member call in a one factor workspace runs 5 statements in 2 transactions instead of 9 (`test_session_check_queries.py`). Only the first call of a minute and a batch write add the upsert.
- With N containers a person can pass a limit by at most N times a twentieth of it before every container sees the total. Modal runs at most 4 web containers, so that is at most a fifth over. Near the limit every call is written, so a single container counts exactly, and the small limits of the tests still answer 429 on the same call.
- Calls counted in memory and not yet written are lost when a container stops. They were all under half the limit.
- The auth scope can now read every workspace's settings. It already reads sessions, people, memberships and session policies across workspaces, and only the session check and sign-in run in it.
