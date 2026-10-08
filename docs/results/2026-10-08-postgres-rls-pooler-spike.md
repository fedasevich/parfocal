# Result: Row-level security, a transaction-mode pooler and bulk inserts on local Postgres

- Date: 2026-10-08
- Backlog: STACK-020
- Kind: spike
- Commit: 314263d (the spike lived in a scratch folder outside the repository and is described below)
- Environment: MacBook with Apple M4, macOS 15.8.1, Docker Desktop, Python 3.14.7. Images `imresamu/postgis:17-3.6.1-alpine3.22` (PostgreSQL 17.10, PostGIS 3.6.1, arm64) and `edoburu/pgbouncer:v1.26.0-p0`. Libraries SQLAlchemy 2.1.4, asyncpg 0.32.0, psycopg 3.3.6. Everything on localhost, no Neon, because the owner asked to stay off the cloud
- Data: synthetic polygons, no PHI

## Question

Does tenant isolation with row-level security and a per-transaction `set_config(..., true)` hold behind a PgBouncer in transaction mode like Neon's? Do asyncpg, SQLAlchemy and psycopg work through that pooler with prepared statements? How should bulk rows reach a table with row-level security?

## Method

`init.sql` creates PostGIS, a login role `app` with `NOBYPASSRLS` that does not own the tables, and an `annotations` table (identity key, `tenant_id uuid`, `slide_id uuid`, `geometry(Polygon, 0)`, label, timestamp) with a B-tree index on tenant and slide, a GiST index on the geometry, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and one policy for reading and writing. Two PgBouncer containers sit in front, both in transaction mode with five server connections, one with `max_prepared_statements = 1000` (what Neon documents for its pooler) and one with `0`. `spike.py` seeds 3 rows for tenant A and 5 for tenant B, then:

1. checks visibility with no tenant set, with tenant A set, and in a later transaction on the same connection,
2. runs 2,000 concurrent transactions alternating tenants through 20 to 40 client connections into five server connections, each setting its tenant, sleeping up to 6 ms and counting rows,
3. repeats with 500 SQLAlchemy `engine.begin()` blocks on the asyncpg dialect and 200 psycopg transactions with `prepare_threshold=0`,
4. inserts 100,000 polygons for a new tenant four ways inside a transaction that sets the tenant: `COPY` into the table, `INSERT ... SELECT FROM unnest(...)`, `COPY` into an `ON COMMIT DROP` temporary table followed by `INSERT ... SELECT`, and asyncpg `executemany`.

The whole run was repeated three times.

## Results

The first policy, `tenant_id = current_setting('app.tenant_id', true)::uuid`, failed with `invalid input syntax for type uuid: ""`. After a transaction that used `set_config(..., true)`, the same session reads the setting back as an empty string instead of NULL. A fresh session reads NULL. With `NULLIF(current_setting('app.tenant_id', true), '')::uuid` in the policy:

| Check | Result |
|---|---|
| Rows with no tenant set | 0 |
| Rows with tenant A set | 3 |
| Rows in the next transaction without setting a tenant | 0 |
| Insert of a tenant B row while tenant A is set | `InsufficientPrivilegeError` |

Through the poolers (transactions, tenant mismatches, errors):

| Client | `max_prepared_statements = 1000` | `max_prepared_statements = 0` |
|---|---|---|
| asyncpg pool, 2,000 transactions | 0 mismatches, 0 errors, 1.56 to 1.59 s | 0 mismatches, 1,528 errors `DuplicatePreparedStatementError` |
| SQLAlchemy asyncpg dialect, 500 transactions | 0 errors | 379 errors, prepared statement already exists |
| psycopg, 200 transactions | 0 errors | 2 errors `DuplicatePreparedStatement` |

Bulk insert of 100,000 polygons through the pooler, in seconds:

| Method | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| `COPY` into the table with row-level security | `FeatureNotSupported: COPY FROM not supported with row-level security` | same | same |
| `INSERT ... SELECT FROM unnest` | 0.620 | 0.667 | 0.658 |
| `COPY` into a temporary table, then `INSERT ... SELECT` | 0.499 | 0.514 | 0.539 |
| asyncpg `executemany` | 0.770 | 0.788 | 0.769 |

asyncpg's binary `COPY` also refused the geometry column on the client side (`no binary format encoder for type geometry`), so the staging table holds WKT text that the `INSERT ... SELECT` converts.

## Interpretation

- Row-level security with a per-transaction setting isolated tenants under heavy interleaving through a transaction-mode pooler. The policy must treat an empty setting as missing.
- Prepared statements through a transaction-mode pooler only work when the pooler tracks them. With that on, every client tested worked unchanged. Assumption: Neon's pooler has it on, as Neon's docs say. TODO: confirm on Neon once the owner fixes the cloud.
- Bulk writes into tables with row-level security go through a temporary staging table. The policy's `WITH CHECK` still applies to the final insert.
- TODO: the Neon region with the lowest latency from Modal's API containers still has to be measured.

## Follow-ups

- [ADR 0018](../adr/0018-postgres-sqlalchemy-rls.md) records the decisions.
- FOUND-013 builds the migration baseline on these rules.
