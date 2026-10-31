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

`pnpm db:up` starts `compose.yaml`. Its health check runs `pg_isready` against `127.0.0.1`, because on a fresh volume the image first runs a temporary server on the Unix socket only, and a socket check passed before the real server was up, which failed a CI migration with "the database system is starting up". The stack has Postgres with PostGIS on port 5432, where `parfocal` owns everything and trust auth is on, and PgBouncer on port 6432 in transaction mode with `max_prepared_statements = 1000`, which logs in as `parfocal_app`. The app connects through the pooler with `DATABASE_URL`, and migrations connect straight to Postgres as the owner with `MIGRATION_DATABASE_URL`, as Neon also advises for migrations. `pnpm db:migrate` runs Alembic from `apps/api/alembic.ini`. `pnpm test:db` starts the stack and runs the tests marked `db`, which `pnpm test` skips. The `db` CI job runs the same compose file.

Every column passes `info=` with its data class from `parfocal_common.data_classes` ([ADR 0028](../adr/0028-data-classes-on-columns.md)), and `pnpm data-map:doc` must be rerun after a schema change or `test_data_map.py` fails. A new tenant-owned table uses the `TenantOwned` and `Timestamped` mixins and, in its migration, the statements from `enable_tenant_isolation` and `track_updated_at` in `parfocal_common.schema_sql`. `test_every_tenant_table_is_isolated_at_head` fails when any table with a `tenant_id` column lacks forced row-level security and the `tenant_isolation` policy. Names follow the convention in `parfocal_common.db`, so constraints read like `pk_notes` and `ix_notes_tenant_id`. Soft delete follows [ADR 0019](../adr/0019-soft-delete-policy.md).

The ADAPT tasks edited migrations `0005` to `0019` in place, because no shared database ever ran them and the hospital code was throwaway ([ADR 0054](../adr/0054-hospital-code-inventory-and-revert-order.md)). That is over: from `0020` on every schema change is a new migration, so local databases upgrade without a reset. A local database made before 2026-10-17 must be recreated once with `docker compose down -v`, `pnpm db:up` and `pnpm db:migrate`. Removed numbers (`0010`, `0013`, `0014`, `0016` and `0017`) are not reused.

## Data migrations set a scope before they touch rows

Every table forces row-level security, so even the owner only sees rows that a policy allows unless the role bypasses it. The local `parfocal` owner is a superuser and bypasses it, which means a migration that updates rows without a scope passes every local test and could change nothing on a host where the owner is not a superuser. Migration `0039` (admin rights) therefore runs `set_config('app.platform', 'on', true)` before it rewrites `memberships` and `invitations`, which the `platform_write` policies allow. The setting is local to the migration's transaction because `env.py` uses one transaction per migration. Do the same in any later migration that reads or writes rows of a tenant table. The platform setting only helps where a table has `platform_write` policies. A table made with `enable_tenant_isolation` allows only `app.tenant_id`, so migration `0041` (inbox mutes) reads the tenants under the platform scope and then sets `app.tenant_id` for each one before it fills the new notification columns. Migration tests can step to the revision before a migration with Alembic's relative form, such as `command.upgrade(config, "0041-1")`, which keeps them right when another migration lands in between. Migration `0043` (muted notifications) adds `notifications.muted` with a server default of false, so it needs no data step and no scope, and existing rows read as not muted.

## Pinning a parent's mode with a composite key

A child row that is only allowed under a parent in one mode carries the mode itself, fixed by a check, and points at a unique key on the parent's id and mode. `patients` and `emergency_grants` carry `privacy_mode` fixed to `clinical` with a key to (`projects.id`, `projects.privacy_mode`). The database then refuses the child under a de-identified project, and refuses to switch a project that has such children, because the key has no `ON UPDATE` action. A check constraint cannot see the parent, so this is the only way to enforce it without a trigger ([ADR 0062](../adr/0062-project-model.md)).

The edoburu PgBouncer image writes `auth_user=` into its generated config, which fails with "bouncer config error" under `auth_type = any`. The compose file mounts `infra/local/pgbouncer.ini` instead, which names a fixed `user=`.

## Restrictive policies narrow, permissive ones widen

Postgres ORs permissive policies and ANDs restrictive ones with the result. A narrower scope inside a tenant, such as the guest case scope that ADAPT-001 removed, must be `RESTRICTIVE`, so it can only take rows away from what tenant isolation allows. A second permissive policy would have widened access instead. Source: [STACK-023 spike](../results/2026-10-08-guest-scope-rls-spike.md).

## Request scope and the tenancy tables

Every request transaction starts with one `SET_SCOPE` statement from `scoped_transaction` in `parfocal_common.db`, which sets `app.tenant_id`, `app.user_id`, `app.platform` and `app.auth` together and clears the ones a scope does not use. In the API only `parfocal_api.context` builds a scope from a principal. Routes take `TenantConnection` or `PlatformConnection` and never set anything themselves ([ADR 0020](../adr/0020-authorization-rls-scopes-and-rbac.md), [ADR 0024](../adr/0024-workspaces-are-tenants.md)).

`organisations` and `tenants` have no `tenant_id` but still force row-level security through `enable_platform_management`. Members read only their own rows, and only the platform scope writes. `test_every_table_has_forced_row_security_at_head` fails for any table without forced row-level security except `alembic_version` and PostGIS's `spatial_ref_sys`. A mutation check on 2026-10-13 showed that `getCurrentTenant` stays isolated even with its `WHERE` removed, and that the isolation suite fails when the tenant policy is loosened. Source: IAM-003 and IAM-004 log entries.

## Who sees people and workspaces

`app.user_id` joins the scope for signed-in people. A member sees their own `memberships` rows in any tenant (`own_memberships`), the tenants those rows point to, and the organisations of visible tenants, because the organisations policy selects from `tenants` and so inherits its row-level security. `users` rows are visible to the person, to members of the current tenant through `memberships`, and to the auth and platform scopes. Policies read other tables only in one direction (users and tenants read memberships, organisations read tenants), which keeps Postgres from recursing. Source: IAM-005 log entry.

## Adding a table means adding it to the isolation suite

`apps/api/tests/test_tenant_isolation.py` fails when a table at head has no seeder in `SEEDERS` or when a GET operation in the OpenAPI schema is missing from `GET_ROUTES`. A new tenant-owned table needs a seeder that inserts rows for the given tenant and adds their ids and a marker string to `Seeded`. A new GET route needs its exposure and a path built from tenant A's ids. The suite then calls every tenant route as tenant A, which must see a marker, and as tenant B, which must see none. Table models in `parfocal_api.tables` must match the migrations, which `test_models_match_the_migrations` checks with Alembic's comparison.

The API tests connect through the pooler to a fresh database per test session, so `infra/local/pgbouncer.ini` has a `*` entry that forwards any database name as `parfocal_app`.

## The audit log

`audit_events` is append-only. The app role has no `UPDATE`, `DELETE` or `TRUNCATE`, and the `audit_events_append_only` trigger refuses changes even for the owner. A `BEFORE INSERT` trigger assigns `seq`, `occurred_at`, `prev_hash` and `hash`, so code only calls `parfocal_api.audit.record` in the same transaction as the change and never sets those columns. Each workspace has its own chain and events without a workspace go to the platform chain (`tenant_id` NULL). The hash covers length-prefixed text fields in a fixed order, which `event_hash` in Python reproduces, so a change to the column list or the trigger must change both, and `test_audit.py` fails if they drift. `details` is stored as canonical JSON text rather than `jsonb`, because `jsonb` rewrites the text and the hash would not be reproducible outside Postgres. People never appear in `audit_events` by subject or user id, only by a pseudonym from `audit_people`, which `record` creates on first use. Row-level security lets a scope create or read a pseudonym only for people it can already see in `users`, so a member scope cannot record an actor whose subject has no `users` row, and test principals must use the subject of a real `users` row. Tests that need to tamper disable the trigger as the owner and re-enable it in a `finally`. Source: [ADR 0027](../adr/0027-audit-log-hash-chain-in-postgres.md).

## Encrypted patient identifiers

Patient name, MRN and birth date are stored only as ciphertext from `parfocal_api.identifiers`, with blind indexes for search ([ADR 0033](../adr/0033-envelope-encryption-with-tenant-data-keys.md), [ADR 0034](../adr/0034-blind-indexes-for-encrypted-patient-identifiers.md)). Load a workspace's keys with `load_keys` for reads and `ensure_keys` before the first write, and never write a ciphertext column directly, because the associated data binds each value to its workspace, patient and column. The API refuses to start without `MASTER_KEYS` (`id:key` pairs, newest first, 32-byte url-safe base64 keys). Generate one with `python3 -c 'import base64, secrets; print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode())'`. Only the platform scope may rewrap or delete `tenant_keys` rows, through restrictive policies, so a test that shreds must use `DatabaseScope(platform=True)`. Source: SEC-004 log entry.

## Foreign keys bypass row-level security

Postgres checks a foreign key without row-level security, so a workspace that knows another workspace's row id could reference it. Every tenant-owned child table therefore points at its parent with a composite key that includes `tenant_id`, such as `specimens (case_id, tenant_id) → cases (id, tenant_id)`, and the parent carries a matching unique constraint. Guest scopes use restrictive policies from `parfocal_common.schema_sql`: `enable_guest_case_scope(table, column)` for rows of the shared case and `hide_from_guests(table)` for tables a guest must never see, such as `patients`. Source: CASES-001 log entry.

## Geometry columns and SRID 0

Annotation geometry is PostGIS `geometry` without a type modifier, in level-0 slide pixels with y down and SRID 0. Declare it as `Geometry(spatial_index=False)` and add the GiST index by hand (`ix_annotations_geometry`), because geoalchemy2 creates its own index outside the metadata and `test_models_match_the_migrations` then sees a stray index. `Geometry(srid=0)` does not work either: the column is created without a type modifier, it reflects with SRID -1, and the comparison reports a type change. `ST_GeomFromGeoJSON` gives SRID 4326 by default, so every write wraps it in `ST_SetSRID(..., 0)`, and the viewport filter builds its envelope with SRID 0.

## Annotations are never deleted by the app

The app role has no `DELETE` on `annotations` and no `UPDATE` or `DELETE` on `annotation_versions`. A delete sets `deleted_at` and adds a version, so undo is a restore. Each change bumps `version` only when the caller sends the current one, and a stale version gets 409 `annotation-changed`. Numbers come from `slide_counters`, one row per slide and letter, with `INSERT ... ON CONFLICT DO UPDATE ... RETURNING last` so a bulk insert gets one contiguous range. OBJ-001 (ID grammar and allocation) must take AI numbers from the same table, so that a reviewer's T⁺ and the next imported T never share a number. Source: [ADR 0076](../adr/0076-annotation-and-ai-result-storage.md).

## Result sets are immutable in the database

AI output cannot change after import, and triggers enforce that, not only the API ([ADR 0077](../adr/0077-result-sets.md)). Rows of `result_objects`, `result_chunks` and `result_set_classes` can be inserted only while their set is `importing`. The app role has no `UPDATE` or `DELETE` on `result_objects` and `result_chunks`, and no `DELETE` on `result_sets` and `result_set_classes`. Once a set is `ready` or `failed`, only `deleted_at` may change, and a class keeps its source name and position, although its mapped project class may change. The worker fills a set through `parfocal_api.result_sets.add_regions`, `add_chunks`, `finish` and `fail`. A geoalchemy2 `Geometry` column wraps its bind in `ST_GeomFromEWKT`, so a bulk insert passes `SRID=0;POLYGON(...)` strings, and a SQL function object as a value fails in asyncpg's `executemany`.

## The least sure first order is stored, so tests simulate a recalibration

`createReviewTask` writes each task slide's order into `review_order` once, as one `bytea` of five bytes per object (the letter, then the number as a little-endian u4), and `getReviewOrder` only slices it with `substring`, so nothing computed later can reshuffle a running review ([ADR 0117](../adr/0117-review-order-is-stored-per-task-slide.md), review order stored per task slide). Only a scope change through `changeReviewTask` rebuilds it, with the seed stored in the row, because `scope_seed` is cleared for every scope except random cells.

- The task's scope is applied before ordering. Cell scopes read chunk files through `app.results`, a `ResultStore` whose only method is `get(object_key) -> bytes`. Locally it is `LocalResultStore` under `RESULT_STORE_DIR` (default `.results`, ignored by git). API tests point `api.app.results` at a `tmp_path` store and write chunks with `chunk_support.chunk_bytes`, and the chunk rows must be inserted while the set is still `importing`.
- A region's certainty is its class probability, else its score. A cell's certainty is its chunk's `probs` byte for its AI class, and a chunk without `probs` or a cell of class 255 is unscored. The cells below a score scope filters on the chunk's detection `score`, a different number.
- Inside regions of interest and unsure zones test each cell's vertex-mean centre with `ST_Contains` on an `unnest` of one chunk's centres, because the API has no shapely. Regions count as inside a region of interest when they intersect it.
- The product has no calibration temperature yet, because that is AINUC-006 (calibration), so there is no real way to recalibrate. `test_review_order.py` stands in for one by rewriting `result_objects` probabilities and scores as the database owner and by rewriting a chunk file's `probs`. The database part works because only missing grants stop the app role from updating `result_objects`, and no trigger refuses an update. When AINUC-006 (calibration) lands, `store_order` applies the temperature before rating objects, and the test should change the temperature instead.
- A chunk row whose file is missing refuses the task with 409 `result-files-missing`, so a test or seeder that adds `result_chunks` rows and then creates a cell scope task through the API must also put the files.

## A platform insert into a tenant table needs its own policy and no RETURNING

`create_tenant` runs in the platform scope, where `tenant_isolation`'s `WITH CHECK (tenant_id = current tenant)` fails, so seeding the new workspace's study templates needs the `platform_seed` policy (`FOR INSERT WITH CHECK` the platform setting) that migration `0044` (study templates) adds to both template tables. The insert must not use `RETURNING`, because Postgres then also checks the `SELECT` policy and the platform scope cannot read the row it just wrote. `seed_built_ins` makes the ids in Python for that reason. The migration seeds workspaces that already exist with the same rows after setting the platform scope, and it imports `built_in_rows` from `parfocal_api.study_templates` with its own `sa.table` column lists, so a later column on the head tables does not break it.

## Hard deletes go through `parfocal_retention_purge()`

The app role has no DELETE on annotations, annotation versions, result rows or audit entries. The only way to hard-delete them is the `SECURITY DEFINER` function `parfocal_retention_purge()` from migration `0036`, which reads the calling workspace's `retention_policies` row and `legal_holds` and purges inside the caller's tenant scope ([ADR 0089](../adr/0089-retention-purge-and-audit-re-anchor.md)). The audit trigger lets a delete through only while that function sets `parfocal.audit_purge`. After an audit purge the oldest remaining entry's `prev_hash` is the `last_hash` of the `audit.purged` entry, and `chain_breaks` starts from there. A test that needs old audit entries rewrites the whole chain with recomputed hashes in a `DO` block that sets `session_replication_role` to `replica`, as `age_audit_entries` in `test_retention.py` does. Retention scheduling looks at every workspace in the database, so a test checks only its own workspace's jobs.

## Row-level security keeps ILIKE off a trigram index

Under the tenant policy, `label ILIKE '%term%'` runs as a sequential scan even with a GIN trigram index, because `ILIKE` is not leakproof and Postgres applies the policy first. As the table owner the same query uses the index, so an `EXPLAIN` outside the tenant scope is misleading. At 100,000 cases the scan takes about 27 ms ([search spike](../results/2026-10-18-search-spike.md)). Read plans inside `scoped_transaction` with the app role.
