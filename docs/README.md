# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-14

## Where we are now

Planning is done. [BACKLOG.md](BACKLOG.md) holds 600 tasks in 40 epics, and 45 are ticked. The planning baseline is [ADR 0002](adr/0002-planning-baseline.md) and the platform is [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare for the web app, edge and storage, Modal for Python and GPUs, and Neon for Postgres. Since 2026-10-08 all work runs locally while the owner fixes the cloud side ([knowledge/platform.md](knowledge/platform.md)). Zitadel Cloud is allowed again since 2026-10-13.

| Area | State |
|---|---|
| Repository and CI | pnpm and Turborepo monorepo with TypeScript 7 and Biome, Python 3.14 with uv ([ADR 0006](adr/0006-monorepo-tooling.md), [ADR 0007](adr/0007-python-tooling.md)). CI runs lint, types, unit, database and Playwright jobs behind `ci-ok`, plus docs and infra workflows. Commits follow Conventional Commits with the backlog ID ([ADR 0014](adr/0014-conventional-commits-and-releases.md)) |
| Stack (M0) | 10 of 40 STACK slots decided by spikes. STACK-019 (Modal cold starts) and STACK-020 (Postgres hosting) wait for cloud access |
| API foundations | Typed settings and client selection by `APP_ENV`, RFC 9457 problems, an Orval client generated from OpenAPI, Postgres 17 with PostGIS behind PgBouncer, forced row-level security on every table and a table-driven isolation suite |
| Identity | Zitadel login through a backend-for-frontend with sessions in Postgres ([ADR 0025](adr/0025-zitadel-bff-login.md)), workspaces as tenants ([ADR 0024](adr/0024-workspaces-are-tenants.md)), memberships, the kit's six roles with a permission declared on every route ([ADR 0026](adr/0026-roles-and-permission-matrix.md)), invitations ([ADR 0030](adr/0030-invitations-bound-to-verified-email.md)), service accounts ([ADR 0029](adr/0029-service-accounts-with-own-api-tokens.md)), idle lock and session control ([ADR 0031](adr/0031-idle-lock-from-explicit-activity.md)), signing rights ([ADR 0032](adr/0032-signing-rights-on-the-membership.md)) |
| Security | A hash-chained audit log naming people by erasable pseudonyms ([ADR 0027](adr/0027-audit-log-hash-chain-in-postgres.md)) a data class on every column with a generated [data map](reference/data-map.md) ([ADR 0028](adr/0028-data-classes-on-columns.md)), and envelope-encrypted patient identifiers with blind indexes ([ADR 0033](adr/0033-envelope-encryption-with-tenant-data-keys.md), [ADR 0034](adr/0034-blind-indexes-for-encrypted-patient-identifiers.md)) |
| Web | A Vite build with typed public config and no screens. The UI is not final, so screens wait |

Who is working on what, what is blocked and what is free to start is on the task board: run `pnpm board` ([board/README.md](board/README.md)).

Accounts and tools are listed in [knowledge/agent-tooling.md](knowledge/agent-tooling.md).

## Next up

No Modal, Neon, staging or production changes and no UI work until the owner says so.

1. Follow-ups from today's decisions: the generated client's error type and options under `exactOptionalPropertyTypes` for STACK-008 (generated client), a browser check of the routing spike, and the OME-Zarr reader for INGEST-003 (ingest workflow skeleton).
2. Backend tasks that need no UI: CASES-023 (due time rules), CASES-015 (patient matching) and CASES-019 (cancel, restore and merge).
3. The owner should review [ADR 0023](adr/0023-gap-review-backend-first.md), still Proposed, because ADRs 0026 to 0032 build on it, and ADRs 0024 to 0051, which were accepted under standing approval.
4. Waiting for the owner: STACK-019 (Modal cold starts, blocked by the spend limit), STACK-020 (Postgres hosting, needs a Neon region measurement), IAM-001 (Zitadel set up from code, needs CI credentials). Waiting for the final UI: IAM-008 (workspace switcher), IAM-014 (admin console), IAM-021 (lock screen), CASES-025 (folder screens) and FOUND-019 (error toasts). FOUND-014 (dependency and licence scanning) is on hold.

## Index

| File | What it holds |
|---|---|
| [BACKLOG.md](BACKLOG.md) | Every task with checkboxes, the Definition of Done and the decisions baseline |
| [log.md](log.md) | Dated log of what was done |
| [board/](board/README.md) | The live task board over the backlog, with one claim file per task being worked on (`pnpm board`) |
| [project/overview.md](project/overview.md) | The product, users, scope, design sources and the POC's role |
| [project/roadmap.md](project/roadmap.md) | Milestones M0 to M6 and their status |
| [project/risks.md](project/risks.md) | Risk register |
| [project/poc-reference.md](project/poc-reference.md) | Where the POC lives, with full links to every POC doc |
| [adr/](adr/README.md) | Decision records |
| [results/](results/README.md) | Measurements, benchmarks, evaluations and studies |
| [knowledge/](knowledge/README.md) | Durable lessons and gotchas by topic |
| [reference/permissions.md](reference/permissions.md) | The role and permission matrix, generated from the API code |
| [compliance/controls.md](compliance/controls.md) | Control matrix mapping GDPR articles, HIPAA Security Rule safeguards and ISO 27001:2022 Annex A controls to backlog tasks, with gaps |
| [reference/data-map.md](reference/data-map.md) | The data class of every database column, generated from the table models |
