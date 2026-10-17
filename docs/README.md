# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-14

## Where we are now

Planning is done, and on 2026-10-17 the product changed direction ([ADR 0053](adr/0053-ai-results-review-direction.md)). Parfocal is now an AI results review app: researchers import or run AI and evaluate it, and doctors review it. [BACKLOG.md](BACKLOG.md) holds 716 tasks in 53 epics, 71 are ticked, and 91 are kept as ideas from the hospital direction. The ADAPT epic reverts or reworks the hospital code in the order of [ADR 0054](adr/0054-hospital-code-inventory-and-revert-order.md). Routing, signing rights, the case state machine, accession numbers, folders, the sign-out permissions and the guest scope are gone, and availability is away until a time with a note. The roles are researcher, reviewer and admin, cases and slides live in projects with optional cases, and patients belong to one clinical project ([ADR 0062](adr/0062-project-model.md)). Only emergency access is left to rework. The planning baseline is [ADR 0002](adr/0002-planning-baseline.md) and the platform is [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare for the web app, edge and storage, Modal for Python and GPUs, and Neon for Postgres. Since 2026-10-08 all work runs locally while the owner fixes the cloud side ([knowledge/platform.md](knowledge/platform.md)). Zitadel Cloud is allowed again since 2026-10-13.

| Area | State |
|---|---|
| Repository and CI | pnpm and Turborepo monorepo with TypeScript 7 and Biome, Python 3.14 with uv ([ADR 0006](adr/0006-monorepo-tooling.md), [ADR 0007](adr/0007-python-tooling.md)). CI runs lint, types, unit, database and Playwright jobs behind `ci-ok`, plus docs and infra workflows. Commits follow Conventional Commits with the backlog ID ([ADR 0014](adr/0014-conventional-commits-and-releases.md)) |
| Stack (M0) | 10 of 40 STACK slots decided by spikes. STACK-019 (Modal cold starts) and STACK-020 (Postgres hosting) wait for cloud access |
| API foundations | Typed settings and client selection by `APP_ENV`, RFC 9457 problems, an Orval client generated from OpenAPI, Postgres 17 with PostGIS behind PgBouncer, forced row-level security on every table and a table-driven isolation suite |
| Identity | Zitadel login through a backend-for-frontend with sessions in Postgres ([ADR 0025](adr/0025-zitadel-bff-login.md)), workspaces as tenants ([ADR 0024](adr/0024-workspaces-are-tenants.md)), memberships, the researcher, reviewer and admin roles with a permission declared on every route ([ADR 0061](adr/0061-researcher-reviewer-and-admin-roles.md)), invitations ([ADR 0030](adr/0030-invitations-bound-to-verified-email.md)), service accounts ([ADR 0029](adr/0029-service-accounts-with-own-api-tokens.md)), idle lock and session control ([ADR 0031](adr/0031-idle-lock-from-explicit-activity.md)), and away status with a note ([ADR 0055](adr/0055-away-until-with-a-note.md)) |
| Security | A hash-chained audit log naming people by erasable pseudonyms ([ADR 0027](adr/0027-audit-log-hash-chain-in-postgres.md)) a data class on every column with a generated [data map](reference/data-map.md) ([ADR 0028](adr/0028-data-classes-on-columns.md)), and envelope-encrypted patient identifiers with blind indexes ([ADR 0033](adr/0033-envelope-encryption-with-tenant-data-keys.md), [ADR 0034](adr/0034-blind-indexes-for-encrypted-patient-identifiers.md)) |
| Web | A Vite build with typed public config and no screens. The UI is not final, so screens wait |

Who is working on what, what is blocked and what is free to start is on the task board: run `pnpm board` ([board/README.md](board/README.md)).

Accounts and tools are listed in [knowledge/agent-tooling.md](knowledge/agent-tooling.md).

## Next up

No Modal, Neon, staging or production changes and no UI work until the owner says so.

1. Follow-ups from today's decisions: the generated client's error type and options under `exactOptionalPropertyTypes` for STACK-008 (generated client), a browser check of the routing spike, and the OME-Zarr reader for INGEST-003 (ingest workflow skeleton).
2. Backend work for the new direction, which needs no UI, in the order of [ADR 0054](adr/0054-hospital-code-inventory-and-revert-order.md), on the project model of [ADR 0062](adr/0062-project-model.md): ADAPT-010 (emergency access for clinical projects), the last ADAPT task, on the project roles of [ADR 0065](adr/0065-project-role-enforcement.md). PROJ-004 (class taxonomy) and PROJ-005 (analysis templates) can follow PROJ-001 too. PROJ-002 (privacy modes) waits for SEC-009 (label and macro images). CASES-015, CASES-019 and CASES-023 are ideas now.
3. The owner should read [ADR 0053](adr/0053-ai-results-review-direction.md) and the new backlog epics, and review [ADR 0023](adr/0023-gap-review-backend-first.md), still Proposed, because ADRs 0026 to 0032 build on it, and ADRs 0024 to 0051, which were accepted under standing approval.
4. Waiting for the owner: STACK-019 (Modal cold starts, blocked by the spend limit), STACK-020 (Postgres hosting, needs a Neon region measurement), IAM-001 (Zitadel set up from code, needs CI credentials). Waiting for the final UI: IAM-008 (workspace switcher), IAM-014 (admin console), IAM-021 (lock screen) and FOUND-019 (error toasts). CASES-025 (folder screens) became an idea and its claim was released. FOUND-014 (dependency and licence scanning) is on hold.

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
