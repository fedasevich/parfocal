# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-18

## Where we are now

Parfocal is an AI results review app since 2026-10-17 ([ADR 0053](adr/0053-ai-results-review-direction.md)): researchers import or run AI on whole slides and evaluate it, and doctors review it. [BACKLOG.md](BACKLOG.md) holds 720 tasks in 53 epics, 111 are ticked, and 96 are kept as ideas. The review loop's backend is built end to end: result sets, object IDs, review tasks with splits and scopes, verdicts, the reviewed layer, opinion answers, review states and moves, the disagreement queue with decisions, sign-off, My work and the evaluation metrics. What is left of M3 is mostly screens, which wait for the final UI. The ingest worker validates every fixture format and makes thumbnails, labels, tissue masks and result objects, but nothing reaches storage yet, because uploads wait for STACK-039 (resumable upload protocol). The platform is [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare for the web app, edge and storage, Modal for Python and GPUs, and Neon for Postgres. Since 2026-10-08 all work runs locally while the owner fixes the cloud side ([knowledge/platform.md](knowledge/platform.md)), and Zitadel Cloud is allowed again since 2026-10-13.

| Area | State |
|---|---|
| Repository and CI | pnpm and Turborepo monorepo with TypeScript 7 and Biome, Python 3.14 with uv ([ADR 0006](adr/0006-monorepo-tooling.md), [ADR 0007](adr/0007-python-tooling.md)). CI runs lint, types, unit, database, Playwright and a `formats` job over the slide fixture corpus behind `ci-ok`, plus docs and infra workflows. Commits follow Conventional Commits with the backlog ID ([ADR 0014](adr/0014-conventional-commits-and-releases.md)) |
| Stack (M0) | 20 of 40 STACK slots decided, the latest being report PDFs with Typst ([ADR 0083](adr/0083-typst-for-report-pdfs.md)). STACK-019 (Modal cold starts) and STACK-020 (Postgres hosting) wait for cloud access |
| API foundations | Typed settings, RFC 9457 problems, an Orval client generated from OpenAPI, Postgres 17 with PostGIS behind PgBouncer, forced row-level security on every table, a table-driven isolation suite and JSON logs with PHI scrubbing |
| Identity | Zitadel login through a backend-for-frontend, workspaces as tenants, the researcher, reviewer and admin roles with a permission on every route ([ADR 0061](adr/0061-researcher-reviewer-and-admin-roles.md)), invitations, service accounts, idle lock and away status. Only workspace members reach workspace routes |
| Projects and cases | Projects with privacy modes, owners and roles ([ADR 0064](adr/0064-project-api.md), [ADR 0065](adr/0065-project-role-enforcement.md)), optional cases with patients only in clinical projects and a CSV import, emergency access, a class taxonomy and versioned opinion forms |
| Review loop (M3) | Annotations ([ADR 0076](adr/0076-annotation-and-ai-result-storage.md)), immutable result sets ([ADR 0077](adr/0077-result-sets.md)), review tasks that open task slides to their reviewers ([ADR 0078](adr/0078-review-task-model.md)), the reviewed layer ([ADR 0079](adr/0079-reviewed-layer.md)), verdicts and opinions ([ADR 0072](adr/0072-verdicts-reasons-and-opinion-forms.md)), derived states with stored moves, the disagreement queue with decisions and sign-off as the owner decided ([ADR 0080](adr/0080-disagreement-rule-and-sign-off.md)), My work ([ADR 0082](adr/0082-my-work-query-api.md)) and the task evaluation ([ADR 0084](adr/0084-evaluation-metrics.md)). See [knowledge/api.md](knowledge/api.md) and [knowledge/evaluation.md](knowledge/evaluation.md) |
| Ingest and results | A Postgres job engine with leases. `parfocal_ingest` identifies formats, checks integrity by structure without an antivirus ([ADR 0081](adr/0081-uploads-are-checked-by-structure.md)), builds the level table, renders thumbnails, extracts labels and macros, builds a tissue mask, reads GeoJSON, QuPath, CSV and mask results, and keeps IDs across result sets ([knowledge/slide-formats.md](knowledge/slide-formats.md), [knowledge/results.md](knowledge/results.md)). Cell chunks have a codec in `parfocal_common.cell_chunks`. None of it is wired to storage yet |
| Security and notifications | A hash-chained audit log with erasable pseudonyms, admin queries and a signed export, a data class on every column with a generated [data map](reference/data-map.md), envelope-encrypted patient identifiers with blind indexes, and notifications as rows with an email outbox |
| Web | A Vite build with typed public config and no screens. The UI is not final, so screens wait |

Who is working on what, what is blocked and what is free to start is on the task board: run `pnpm board` ([board/README.md](board/README.md)).

Accounts and tools are listed in [knowledge/agent-tooling.md](knowledge/agent-tooling.md).

## Next up

No Modal, Neon, staging or production changes and no UI work until the owner says so.

1. Backend work that is still free: RSET-002 (Parfocal JSON schema and validator, with its help drawer split into a screen task), RSET-008 (export reviewed annotations), HOME-000 and HOME-001 (home aggregates), REVIEW-000 (research check for the confidence rules) and the sentinel node REVIEW tasks after it, and SEC-009 (label and macro handling) once storage exists.
2. Waiting for uploads to reach storage (STACK-039, INGEST-001): wiring the ingest steps, writing imported objects into result sets, cell classes in the evaluation, and object-level progress in My work.
3. Waiting for the final UI: every screen task, including the ones whose backend was split out (ADJ-002, GUIDE-007, EVAL-002), and the browser checks INGEST-009, INGEST-013 and INGEST-016.
4. Follow-ups from earlier decisions: the generated client's error type and options under `exactOptionalPropertyTypes` for STACK-008 (generated client), a browser check of the routing spike, and the OME-Zarr reader.
5. The owner should read [ADR 0053](adr/0053-ai-results-review-direction.md) and ADRs 0054 to 0084, which were accepted under standing approval on 2026-10-17 and 2026-10-18, except ADRs 0080 and 0081, which record the owner's own choices, and ADRs 0024 to 0051.
6. Waiting for the owner: STACK-019 (Modal cold starts, blocked by the spend limit), STACK-020 (Postgres hosting, needs a Neon region measurement), IAM-001 (Zitadel set up from code, needs CI credentials). FOUND-014 (dependency and licence scanning) is on hold.

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
| [security/threat-model.md](security/threat-model.md) | STRIDE threat model for upload, tile access, guest links, AI jobs and realtime, with the task that mitigates each high risk |
| [compliance/controls.md](compliance/controls.md) | Control matrix mapping GDPR articles, HIPAA Security Rule safeguards and ISO 27001:2022 Annex A controls to backlog tasks, with gaps |
| [reference/parfocal-results-v1.md](reference/parfocal-results-v1.md) | The Parfocal results file: its fields, how to check a file and the validator's error codes, with the [schema](reference/parfocal-results-v1.schema.json) and a [template](reference/parfocal-results-v1.template.json) |
| [reference/data-map.md](reference/data-map.md) | The data class of every database column, generated from the table models |
