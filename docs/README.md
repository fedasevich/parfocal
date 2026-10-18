# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-18

## Where we are now

Parfocal is an AI results review app since 2026-10-17 ([ADR 0053](adr/0053-ai-results-review-direction.md)): researchers import or run AI on whole slides and evaluate it, and doctors review it. [BACKLOG.md](BACKLOG.md) holds 716 tasks in 53 epics, 90 are ticked, and 96 are kept as ideas. M3 (review loop) is under way: projects, roles, the class taxonomy, opinion forms and the annotation API are built, and the designs for object IDs, verdicts, result files and result storage are decided. The ingest worker identifies and validates every fixture format, and makes thumbnails, labels and tissue masks, but nothing reaches storage yet, because uploads wait for STACK-039 (resumable upload protocol). The platform is [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare for the web app, edge and storage, Modal for Python and GPUs, and Neon for Postgres. Since 2026-10-08 all work runs locally while the owner fixes the cloud side ([knowledge/platform.md](knowledge/platform.md)), and Zitadel Cloud is allowed again since 2026-10-13.

| Area | State |
|---|---|
| Repository and CI | pnpm and Turborepo monorepo with TypeScript 7 and Biome, Python 3.14 with uv ([ADR 0006](adr/0006-monorepo-tooling.md), [ADR 0007](adr/0007-python-tooling.md)). CI runs lint, types, unit, database, Playwright and a `formats` job over the slide fixture corpus behind `ci-ok`, plus docs and infra workflows. Commits follow Conventional Commits with the backlog ID ([ADR 0014](adr/0014-conventional-commits-and-releases.md)) |
| Stack (M0) | 19 of 40 STACK slots decided. STACK-019 (Modal cold starts) and STACK-020 (Postgres hosting) wait for cloud access |
| API foundations | Typed settings and client selection by `APP_ENV`, RFC 9457 problems, an Orval client generated from OpenAPI, Postgres 17 with PostGIS behind PgBouncer, forced row-level security on every table, a table-driven isolation suite and JSON logs with PHI scrubbing ([ADR 0068](adr/0068-structured-logging-on-the-standard-library.md)) |
| Identity | Zitadel login through a backend-for-frontend with sessions in Postgres ([ADR 0025](adr/0025-zitadel-bff-login.md)), workspaces as tenants ([ADR 0024](adr/0024-workspaces-are-tenants.md)), the researcher, reviewer and admin roles with a permission on every route ([ADR 0061](adr/0061-researcher-reviewer-and-admin-roles.md)), invitations, service accounts, idle lock and away status. Only workspace members reach workspace routes |
| Projects (M3) | Projects with privacy modes, owners, archiving and members ([ADR 0064](adr/0064-project-api.md)), project roles that narrow every case route ([ADR 0065](adr/0065-project-role-enforcement.md)), optional cases with patients only in clinical projects ([ADR 0063](adr/0063-cases-and-slides-in-projects.md)), emergency access per clinical project ([ADR 0066](adr/0066-emergency-access-per-clinical-project.md)), a class taxonomy with a colour check ([ADR 0067](adr/0067-class-taxonomy-and-colour-check.md)) and versioned opinion forms ([ADR 0072](adr/0072-verdicts-reasons-and-opinion-forms.md)) |
| Review data (M3) | Annotations with versions and history under `/api/slides/{id}/annotations` ([ADR 0076](adr/0076-annotation-and-ai-result-storage.md)). Decided but not built: object IDs ([ADR 0071](adr/0071-object-id-grammar.md)), verdicts ([ADR 0072](adr/0072-verdicts-reasons-and-opinion-forms.md)), result file readers ([ADR 0070](adr/0070-result-file-parsers.md)), cell chunks in object storage ([ADR 0076](adr/0076-annotation-and-ai-result-storage.md)) and the slide pipeline states ([ADR 0069](adr/0069-slide-pipeline.md)) |
| Ingest and jobs | A Postgres job engine with leases that survives a killed worker ([ADR 0044](adr/0044-background-jobs-and-workflows.md), [knowledge/jobs.md](knowledge/jobs.md)). `parfocal_ingest` identifies formats by content, builds the level table with the right pyramid and pixel size, renders thumbnails and overviews checked against goldens ([ADR 0075](adr/0075-slide-thumbnails-and-overviews.md)), extracts labels and macros, and builds a tissue mask ([knowledge/slide-formats.md](knowledge/slide-formats.md)). The workflow steps are still placeholders until uploads reach storage |
| Security and notifications | A hash-chained audit log with erasable pseudonyms, admin queries and a signed export ([ADR 0027](adr/0027-audit-log-hash-chain-in-postgres.md), [ADR 0073](adr/0073-audit-queries-and-signed-export.md)), a data class on every column with a generated [data map](reference/data-map.md), envelope-encrypted patient identifiers with blind indexes, and notifications as rows with an email outbox ([ADR 0074](adr/0074-notifications-as-rows-with-an-email-outbox.md)) |
| Web | A Vite build with typed public config and no screens. The UI is not final, so screens wait |

Who is working on what, what is blocked and what is free to start is on the task board: run `pnpm board` ([board/README.md](board/README.md)).

Accounts and tools are listed in [knowledge/agent-tooling.md](knowledge/agent-tooling.md).

## Next up

No Modal, Neon, staging or production changes and no UI work until the owner says so.

1. Built for the review loop since the last consolidation: result sets (RSET-001), object IDs and their matching across sets (OBJ-001, OBJ-002), the result file readers (RSET-003), review tasks (TASK-001) and the reviewed layer (RSET-007). Writing imported objects into result sets waits for uploads to reach storage (STACK-039, INGEST-001).
2. With sign-off decided ([ADR 0080](adr/0080-disagreement-rule-and-sign-off.md)), the review chain continues: TASK-002 (slide states per task and reviewer), then GUIDE-001 (verdict model and API), TASK-003 (scope and progress), ADJ-001 (disagreement detection) and ADJ-004 (sign-off). WL-001 (My work query API) follows TASK-002.
3. Ingest work that needs the browser viewer waits with the UI: INGEST-009 (seams check), INGEST-013 (derived levels for ladder gaps) and INGEST-016 (big-endian BigTIFF).
4. Follow-ups from earlier decisions: the generated client's error type and options under `exactOptionalPropertyTypes` for STACK-008 (generated client), a browser check of the routing spike, and the OME-Zarr reader.
5. The owner should read [ADR 0053](adr/0053-ai-results-review-direction.md) and ADRs 0054 to 0079, which were accepted under standing approval on 2026-10-17 and 2026-10-18, and ADRs 0024 to 0051. ADRs 0080 and 0081 record the owner's own choices.
6. Waiting for the owner: STACK-019 (Modal cold starts, blocked by the spend limit), STACK-020 (Postgres hosting, needs a Neon region measurement), IAM-001 (Zitadel set up from code, needs CI credentials). Waiting for the final UI: IAM-008 (workspace switcher), IAM-014 (admin console), IAM-021 (lock screen) and FOUND-019 (error toasts). PROJ-002 (privacy modes) waits for SEC-009 (label and macro images). FOUND-014 (dependency and licence scanning) is on hold.

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
| [reference/parfocal-results-v1.schema.json](reference/parfocal-results-v1.schema.json) | Draft JSON Schema for Parfocal results files, published by RSET-002 |
| [reference/data-map.md](reference/data-map.md) | The data class of every database column, generated from the table models |
