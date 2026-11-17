# 0395. Home reads in batches and the session check carries the workspace status

- Date: 2026-11-17
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: OPS-030 (a warm API call answers in under 300 ms). Builds on [ADR 0393](0393-the-session-check-reads-the-two-factor-setting-and-counts-in-batches.md) (the session check reads the two factor setting and counts calls in batches)

## Context

Modal cannot pin the cloud, so a database round trip costs 15 to 50 ms depending on where the container lands, and the only lever left is fewer round trips. In the owner's browser on v0.17.4 `/api/me/home` ran 22 queries (db 586 ms), `/api/me` 5 queries in 2 transactions (db 199 ms) and `/api/projects` 7 queries (db 242 ms).

## Decision

- `/api/me/home` reads each kind of data once for all projects and tasks. The task list carries the person's decision count as a scalar column. The project cards, their counts and their four-slide strips come from one statement (a CTE of the person's projects left-joined to the visible slides, with window counts per project). The resume target comes from one statement that unions the last activity, the stored resume state and the first open task, and carries the slide label, case label and decision count on each row. The resume position reuses the assignments the task list already loaded. The open disagreement count is one statement that joins review decisions to the stored decisions and keeps the slides everyone has submitted, because the count needs neither the redrawn edits nor the sent adjudications that the full queue reads.
- The session check reads the workspace status in its one statement. Migration 0137 (the auth scope reads tenants) adds an `auth_read` select policy on `tenants`, the same shape as 0136 for workspace settings. The status rides on `MemberPrincipal` and `tenant_connection` skips its own status read when it is there. A missing status (a service token, a tenant row the auth scope cannot see because migration 0137 has not run, or a deleted workspace) falls back to the old read, so a NULL still ends in Forbidden and a suspended workspace still ends in the suspended answer.
- The session check and the handler stay in two transactions.

## Why two transactions stay

Sharing one transaction would save the BEGIN and COMMIT round trips of the second transaction, about two of the roughly nine that `/api/me` makes. It is not safe as a general change.

- The check writes (the last seen touch, the batched rate counter upsert, the delete of an expired session) must commit even when the handler raises, or a client that only produces error answers would never be counted. Sharing would roll them back with the handler.
- Those writes take row locks on the session and counter rows, which would then be held for the length of the handler.
- `authenticate` is also the plain principal dependency of routes that open no tenant connection, and many tests replace it. A connection handed from `authenticate` to `tenant_connection` would stay checked out on every other route, or need a request-scoped cleanup that every route shape must respect.

The one shape that passes is to hand the connection over only when the check wrote nothing and the route asks for a tenant connection, with all four scope settings overwritten before the first handler statement. It needs `authenticate` and `tenant_connection` rebuilt as one generator dependency, which is bigger than this task. A backlog task follows if the measured medians still miss 300 ms.

## Consequences

- A warm member call that touches no data runs 4 statements in 2 transactions (the session read, the scope, the handler read and the handler's own scope), one fewer than before (`test_session_check_queries.py`).
- Home reads 8 statements for a person who is both an adjudicator and a reviewer, 9 in the test harness, which skips the session check and so also runs the status read. Before it read 14 in the same harness and 22 on the deployed app.
- Migration 0137 must run before the new code serves, or every call falls back to the status read and nothing else changes.
- The auth scope can now read every workspace's name and status. It already reads sessions, memberships, session policies and workspace settings across workspaces, and only the session check and sign-in run in it.
