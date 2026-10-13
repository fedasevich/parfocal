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

## Local database and migrations

`pnpm db:up` starts `compose.yaml`: Postgres with PostGIS on port 5432, where `parfocal` owns everything and trust auth is on, and PgBouncer on port 6432 in transaction mode with `max_prepared_statements = 1000`, which logs in as `parfocal_app`. The app connects through the pooler with `DATABASE_URL`, and migrations connect straight to Postgres as the owner with `MIGRATION_DATABASE_URL`, as Neon also advises for migrations. `pnpm db:migrate` runs Alembic from `apps/api/alembic.ini`. `pnpm test:db` starts the stack and runs the tests marked `db`, which `pnpm test` skips. The `db` CI job runs the same compose file.

A new tenant-owned table uses the `TenantOwned` and `Timestamped` mixins and, in its migration, the statements from `enable_tenant_isolation` and `track_updated_at` in `parfocal_common.schema_sql`. `test_every_tenant_table_is_isolated_at_head` fails when any table with a `tenant_id` column lacks forced row-level security and the `tenant_isolation` policy. Names follow the convention in `parfocal_common.db`, so constraints read like `pk_notes` and `ix_notes_tenant_id`. Soft delete follows [ADR 0019](../adr/0019-soft-delete-policy.md).

The edoburu PgBouncer image writes `auth_user=` into its generated config, which fails with "bouncer config error" under `auth_type = any`. The compose file mounts `infra/local/pgbouncer.ini` instead, which names a fixed `user=`.

## Restrictive policies narrow, permissive ones widen

Postgres ORs permissive policies and ANDs restrictive ones with the result. Guest scopes are `RESTRICTIVE`, so they can only take rows away from what tenant isolation allows. A second permissive policy would have widened access instead. Source: [STACK-023 spike](../results/2026-10-08-guest-scope-rls-spike.md).

## Request scope and the tenancy tables

Every request transaction starts with one `SET_SCOPE` statement from `scoped_transaction` in `parfocal_common.db`, which sets `app.tenant_id`, `app.scope_case_id`, `app.scope_view_id` and `app.platform` together and clears the ones a scope does not use. In the API only `parfocal_api.context` builds a scope from a principal. Routes take `TenantConnection` or `PlatformConnection` and never set anything themselves ([ADR 0020](../adr/0020-authorization-rls-scopes-and-rbac.md), [ADR 0024](../adr/0024-workspaces-are-tenants.md)).

`organisations` and `tenants` have no `tenant_id` but still force row-level security through `enable_platform_management`. Members read only their own rows, and only the platform scope writes. `test_every_table_has_forced_row_security_at_head` fails for any table without forced row-level security except `alembic_version` and PostGIS's `spatial_ref_sys`. A mutation check on 2026-10-13 showed that `getCurrentTenant` stays isolated even with its `WHERE` removed, and that the isolation suite fails when the tenant policy is loosened. Source: IAM-003 and IAM-004 log entries.

## Adding a table means adding it to the isolation suite

`apps/api/tests/test_tenant_isolation.py` fails when a table at head has no seeder in `SEEDERS` or when a GET operation in the OpenAPI schema is missing from `GET_ROUTES`. A new tenant-owned table needs a seeder that inserts rows for the given tenant and adds their ids and a marker string to `Seeded`. A new GET route needs its exposure and a path built from tenant A's ids. The suite then calls every tenant route as tenant A, which must see a marker, and as tenant B, which must see none. Table models in `parfocal_api.tables` must match the migrations, which `test_models_match_the_migrations` checks with Alembic's comparison.

The API tests connect through the pooler to a fresh database per test session, so `infra/local/pgbouncer.ini` has a `*` entry that forwards any database name as `parfocal_app`.
