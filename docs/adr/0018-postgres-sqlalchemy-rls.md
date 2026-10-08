# 0018. Postgres 17 with PostGIS, SQLAlchemy 2.1 on asyncpg, Alembic and row-level security per transaction

- Date: 2026-10-08
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-020, STACK-023, FOUND-013, FOUND-009, OPS-004

## Context

[ADR 0003](0003-pilot-platform-architecture.md) put the database on Neon with its PgBouncer pooler in transaction mode and tenant isolation by row-level security. STACK-020 has to settle the ORM, driver and migrations, how tenant context reaches Postgres behind the pooler, how bulk rows are written, autovacuum for annotation tables and the Neon region. The owner asked to keep off the cloud for now, so the spike ran against local Postgres and PgBouncer configured like Neon. Versions were checked on 2026-10-08.

## Options considered

1. ORM: SQLAlchemy 2.1 with its async API (typed, mature, Alembic, GeoAlchemy2), SQLModel (a thin layer over SQLAlchemy whose models mix with Pydantic, behind on SQLAlchemy releases), or Piccolo (smaller ecosystem, no PostGIS story).
2. Driver: asyncpg 0.32 (fastest, binary protocol, its binary COPY cannot encode PostGIS geometry) or psycopg 3.3 (text COPY works with geometry, slightly slower). Both worked through the pooler in the spike.
3. Tenant context: `SET LOCAL` through `set_config(name, value, true)` inside each transaction, a session-level `SET` (unsafe behind a transaction pooler), or a database role per tenant (does not scale and fights pooling).
4. Bulk writes into tables with row-level security: direct `COPY` (refused by Postgres), `INSERT ... SELECT FROM unnest`, or `COPY` into a temporary table followed by `INSERT ... SELECT`.

## Decision

| Concern | Choice |
|---|---|
| Database | PostgreSQL 17 with PostGIS 3.6. Neon in the cloud. Locally and in CI `imresamu/postgis:17-3.6.1-alpine3.22`, which ships arm64 as well as amd64, behind `edoburu/pgbouncer` in transaction mode with `max_prepared_statements = 1000` so local runs behave like Neon |
| ORM and migrations | SQLAlchemy 2.1 async with GeoAlchemy2 for geometry, Alembic for migrations |
| Driver | asyncpg through SQLAlchemy's `postgresql+asyncpg` dialect, with the default statement cache |
| Roles | Migrations run as the owner role. The API connects as a role that owns nothing and has `NOBYPASSRLS` |
| Tenant isolation | Every tenant-owned table has `tenant_id uuid NOT NULL`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and a policy `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid` for `USING` and `WITH CHECK`. The API's first statement in every transaction is `SELECT set_config('app.tenant_id', :tenant, true)`. Never a session-level `SET` |
| Bulk writes | `COPY` text rows into an `ON COMMIT DROP` temporary table, then `INSERT ... SELECT` into the real table, so the policy still checks each row |
| Autovacuum | Annotation tables start with `autovacuum_vacuum_scale_factor = 0.02`, `autovacuum_vacuum_insert_scale_factor = 0.05` and `autovacuum_analyze_scale_factor = 0.01`, set per table in their migration. OPS-004's load test confirms or changes them |
| Neon region | Not decided. TODO: measure from Modal's API containers when the cloud is back. The current project is in US East (`iad1`) |

Evidence is in [results/2026-10-08-postgres-rls-pooler-spike.md](../results/2026-10-08-postgres-rls-pooler-spike.md).

## Consequences

- The `NULLIF` matters. Without it, a request that forgot its tenant gets an error or zero rows depending on which server connection the pooler hands it, so isolation tests must run through the pooler, not only against Postgres directly.
- Prepared statements depend on the pooler tracking them. If Neon's pooler turns out not to, set asyncpg's `statement_cache_size` to 0 and give SQLAlchemy a `prepared_statement_name_func`, and record that in a new ADR.
- Model output stays out of Postgres as STACK-021 planned. Only human annotations and summaries go through the staging-table path.
- STACK-020 stays open until the Neon region is measured. FOUND-013 can start now.
