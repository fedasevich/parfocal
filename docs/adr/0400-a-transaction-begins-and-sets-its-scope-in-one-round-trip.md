# 0400. A transaction begins and sets its scope in one round trip

- Date: 2026-11-18
- Status: Accepted
- Deciders: agent, for Yurii Fedas
- Backlog: OPS-030 (a warm API call answers in under 300 ms). Builds on [ADR 0395](0395-home-reads-in-batches-and-the-session-check-carries-the-workspace-status.md) (home reads in batches and the session check carries the workspace status)

## Context

A wire trace of the local API through a delaying TCP proxy ([result](../results/2026-11-18-round-trips-per-transaction.md)) showed that every `scoped_transaction` paid three round trips before and after its own reads: SQLAlchemy's asyncpg driver sends `BEGIN` alone, then the prepared scope statement, then `COMMIT`. A signed-in call opens two transactions, so six of the nine round trips of `/api/me` were this frame. Where a Modal container lands in AWS Ireland a round trip to Neon in Frankfurt costs tens of milliseconds, so the frame is most of a warm call.

## Decision

- `scoped_transaction` checks the connection out in driver autocommit and sends `BEGIN; SELECT set_config(...)` as one simple query, then yields the connection, then sends `COMMIT`, or `ROLLBACK` when the body raises. The server transaction is the same as before, so savepoints, row security and the deferred constraints behave as they did.
- The scope values are written as literals. Each one is either empty, `on` or a value that parses as a UUID, and anything else raises before a byte is sent, so the literal cannot carry SQL.
- A driver error on these statements invalidates the connection and is raised as SQLAlchemy's `DBAPIError` subclass, so an `IntegrityError` at commit still reaches the handlers that map it.
- The combined statement counts as one query in Server-Timing, so the query counts stay comparable with earlier numbers.

## Alternatives

- Keep `engine.begin()` and the prepared scope statement. Three round trips per transaction.
- One transaction for the session check and the handler. ADR 0395 lists why it is not safe in general, and with this change it would save one more round trip, not three.
- Switch to psycopg 3 for its pipeline mode. A driver change across every service for a gain this change mostly gets.

## Consequences

- A transaction with N reads costs N plus 2 round trips, was N plus 3 (`test_db_round_trips.py`). A signed-in call saves two.
- Code that sets the scope again inside a transaction (second factor and SSO sign-in) still uses the prepared `SET_SCOPE`.
- `engine.begin()` and `engine.connect()` used directly keep the driver's own transactions.
