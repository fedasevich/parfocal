# 0088. Rate limits per person and per workspace are counted in Postgres by the API, and per-IP limits sit at the edge

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (owner's choice on 2026-10-18)
- Backlog: SEC-012, SEC-027, INGEST-001

## Context

SEC-012 asks for per user and per tenant limits on the API and uploads, and bot protection on login. The API runs as several Modal containers behind the edge Worker ([ADR 0003](0003-pilot-platform-architecture.md)), so a counter must be shared between containers. Only the API knows who the person and the workspace are, and the edge knows the client address. The [threat model](../security/threat-model.md) lists floods of the API, tiles, jobs and sockets (X3, T4, J7, R5). Cloud work is paused, so nothing at the edge can be tested yet.

## Options considered

1. The API counts per person and per workspace in Postgres, and the edge limits per IP. Exact, testable locally now, about one extra upsert per authenticated request, which the session check already pays a transaction for.
2. Edge only, with Cloudflare's rate limiting binding or a Durable Object per workspace. No database load, but the edge must learn the workspace from a token, the binding counts per location, and nothing can be tested now.
3. In memory per API container. No storage, but the real limit grows with the number of containers.

## Decision

Option 1, chosen by the owner.

- `rate_counters` is an UNLOGGED table of fixed one-minute windows keyed by `user:<id>`, `service:<id>` or `tenant:<id>`, visible only to the auth scope like the session tables. Losing it in a crash only resets the counts.
- `authenticate` counts the request in the transaction it already opens to check the session or token, with one `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` for the person and the workspace. A request over either limit gets 429 `rate-limited` with `Retry-After` set to the seconds left in the window. Refused requests are rolled back, so they do not count.
- Defaults are 600 a minute per person or service account and 3,000 a minute per workspace, set by `RATE_LIMIT_PERSON_PER_MINUTE` and `RATE_LIMIT_TENANT_PER_MINUTE`. TODO: tune them from pilot traffic.
- Windows older than five minutes are swept by about one request in a hundred.
- Unauthenticated routes (health, login) are not counted by the API. Per-IP limits on login, uploads and tiles, and bot protection on login, move to a new task, SEC-027 (edge limits per IP), which waits for cloud work.

## Consequences

- SEC-012 ships the limiter with a concurrent burst test, a shared workspace limit and a signed-in person's limit.
- Tests that override the principal through `ApiAs` skip `authenticate` and are never limited.
- INGEST-001 (upload API) adds a separate upload bucket with its own lower limit when uploads exist. TODO: set that limit there.
- If the extra upsert shows up in API latency on Neon, the counters can move to the edge as option 2 without changing the 429 contract.
