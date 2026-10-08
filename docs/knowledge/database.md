# Database

Lessons about Postgres, PostGIS and the pooler, as decided in [ADR 0018](../adr/0018-postgres-sqlalchemy-rls.md).

## A cleared custom setting reads back as an empty string

After a transaction runs `set_config('app.tenant_id', ..., true)`, later transactions in the same session read `current_setting('app.tenant_id', true)` as `''`, not NULL. A fresh session reads NULL. Casting `''` to `uuid` raises an error, so behind a pooler a request without a tenant fails or sees nothing depending on which server connection it gets. Every policy uses `NULLIF(current_setting('app.tenant_id', true), '')::uuid`. Source: [STACK-020 spike](../results/2026-10-08-postgres-rls-pooler-spike.md).

## COPY FROM is refused on tables with row-level security

Postgres answers `COPY FROM not supported with row-level security`. Copy into an `ON COMMIT DROP` temporary table and `INSERT ... SELECT` from it, which was also the fastest way in the spike. asyncpg's binary COPY cannot encode PostGIS geometry either, so stage geometry as WKT or EWKB text.

## Transaction-mode pooling needs prepared-statement tracking

Through PgBouncer in transaction mode with `max_prepared_statements = 0`, asyncpg, SQLAlchemy and psycopg all fail with "prepared statement already exists". With it set, as Neon documents for its pooler, they work unchanged. The local stack sets it to 1000.

## The official PostGIS images have no arm64 build

`postgis/postgis:17-*` only ships amd64, and Docker on Apple silicon refuses it with "no matching manifest for linux/arm64/v8". `imresamu/postgis`, published by a docker-postgis maintainer, has arm64 and amd64 builds of the same tags.
