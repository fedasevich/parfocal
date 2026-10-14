# 0028. Five data classes declared on every column, with a generated data map

- Date: 2026-10-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: SEC-001, SEC-004, SEC-007, SEC-010, FOUND-011

## Context

SEC-001 asks to classify every field as PHI, personal, operational or public, to generate a data map from annotations in code, and to fail CI when a new column has none. Later tasks need the classes: SEC-004 encrypts direct patient identifiers, SEC-007 finds a person's data for access and erasure, and FOUND-011 and SEC-010 keep PHI out of logs and telemetry. Tables are SQLAlchemy Core tables in `parfocal_api.tables`, and `test_models_match_the_migrations` already fails when the database has a column the models lack.

## Options considered

1. Where the class lives. A separate inventory file is easy to read, but it drifts from the models and needs its own sync check. A Postgres `COMMENT` per column travels with the database, but it must be written in every migration and is invisible when reading the model. SQLAlchemy's `info` dictionary on each `Column` sits next to the declaration, costs nothing at runtime and is readable by tests and generators.
2. Which classes. The backlog names four. Credentials, token hashes and PKCE verifiers fit none of them: they are not personal data, but treating them as operational would let them reach logs and exports. A fifth class, `secret`, keeps that line visible.

## Decision

Every column declares `info=PHI`, `PERSONAL`, `SECRET`, `OPERATIONAL` or `PUBLIC` from `parfocal_common.data_classes`, including the shared mixin columns. Pseudonymous ids that point at one person, such as user ids and audit pseudonyms, are `personal`. `test_data_map.py` fails when a column has no class, when a table in the metadata is missing from the map, or when `docs/reference/data-map.md` is stale. `pnpm data-map:doc` regenerates that page.

## Consequences

- A new column cannot reach `main` without a class, because the model must match the migration and the model must be classified.
- The class is a label, not a control. SEC-004, SEC-010 and FOUND-011 must read it to encrypt or redact. TODO: those tasks wire it in.
- No column is `phi` yet. The first ones arrive with CASES-001.
