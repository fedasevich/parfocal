# 0328. The 96 migrations are squashed into one baseline that keeps revision 0115

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: FOUND-035 (squash the migrations into one baseline). Changes the migration rule in [knowledge/database.md](../knowledge/database.md).

## Context

The API had 96 Alembic migrations, `0001` to `0115`, and every fresh database ran all of them. Many imported application code: `0044` (study templates) read `built_in_rows` from `parfocal_api.study_templates` and `0114` (registered models) read `seed_rows` from `parfocal_api.model_registry`, so a later change to those modules could change what an old migration does or break it. No shared database holds real data yet, and [ADR 0293](0293-production-only-until-the-first-real-user.md) (production only until the first real user) lets the owner's test data in production be reset. After OPS-014 (bring back staging before the first real user) a squash would cost a data migration on every environment, so it is free only now.

## Options

1. Keep the chain and live with its length and its imports.
2. Write the baseline by hand from the table models with `metadata.create_all` plus the policies, triggers, functions and grants as extra SQL.
3. Dump the schema the old chain builds with `pg_dump --schema-only --no-owner`, keep it as one SQL file, freeze the seed rows as literal inserts, and prove with a test that the result matches the old chain.

## Decision

Option 3. `apps/api/migrations/baseline.sql` holds the schema the old chain built on Postgres 18 with PostGIS 3.6, followed by the ten registered model rows that `0114` seeded, as literal inserts under the platform scope. The migration `0115_baseline.py` runs it statement by statement, with the statements split on a bare `--` line, and imports nothing from the application. It keeps revision `0115` with no parent, so a database the old chain already brought to `0115` counts as being at the baseline and runs nothing, and the deploy check in `parfocal_deploy.migrations` sees no pending revision. A database at an older revision must be recreated. Its downgrade drops every non-extension table and function and PostGIS.

The dump needed two changes to rebuild the same catalog. The session `SET` lines, the default privileges (which name the owner role) and the `alembic_version` table are left out, and the migration grants the default privileges itself for the configured app role. Postgres prints a check of a `varchar` column against a list as `((kind)::text = ANY ((ARRAY['a'::character varying])::text[]))`, and parsing that text gives a different expression than the `kind IN ('a')` the old migrations wrote, so these checks and the one partial index were written back in the `IN` form.

`tests/schema_fingerprint.py` reads extensions, relations with their row security and grants, columns with types, defaults and identity, constraints, indexes, triggers, functions, enum and domain types, policies, default and schema privileges, and every table's rows without minted ids and timestamps, and hashes each object. `tests/fixtures/schema_of_the_old_chain.json` was written once from the old chain at its revision `0115` and is never regenerated. `test_the_baseline_gives_the_schema_of_the_old_chain` upgrades a fresh database to `0115` and compares, and `test_a_changed_schema_differs_from_the_old_chain` shows that a dropped check, a loosened column, a revoked grant or a changed seed row each break the match. `test_the_baseline_imports_no_application_code` reads the migration's imports.

The tests of single old data migrations (`0039`, `0041`, `0043`, `0044`, `0050`, `0080`, `0083` and `0111`) went with them, because those migrations no longer exist.

## Consequences

- A fresh database runs one migration. Every schema change after this is a new migration on top of `0115`, numbered from `0116`, and the baseline and the frozen fixture are never edited.
- Production needs no reset if it is already at `0115`. If it is older, the next deploy fails with the history error, and the owner's test database is recreated under ADR 0293. This task touched no production system.
- `seed_rows` in `parfocal_api.model_registry` no longer feeds any migration. A later change to the built-in models needs its own migration.
- To regenerate the baseline one would need the old chain, which lives in the history before this commit.
