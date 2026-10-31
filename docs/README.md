# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-18

## Where we are now

Parfocal is an AI results review app since 2026-10-17 ([ADR 0053](adr/0053-ai-results-review-direction.md)): researchers import or run AI on whole slides and evaluate it, and doctors review it. [BACKLOG.md](BACKLOG.md) holds 734 tasks in 53 epics, 135 are ticked, and 96 are kept as ideas. The review loop's backend is built end to end: result sets, object IDs, review tasks with splits and scopes, verdicts, the least sure first order, the reviewed layer and its export, opinion answers, review states and moves, blinding with a kept first read without the AI ([ADR 0118](adr/0118-blinding-and-a-kept-first-read.md), proposed), the disagreement queue with decisions, sign-off, My work with next and previous slide, the evaluation metrics, Home's aggregate with announcements, the notification catalogue and the sentinel node staging rules. The security backend gained a threat model, an Origin check on cookie writes, rate limits, retention with legal holds and access and erasure workflows. What is left of M3 is mostly screens, which wait for the final UI. The ingest worker validates every fixture format and makes thumbnails, labels, tissue masks and result objects, but nothing reaches storage yet. The upload protocol is [ADR 0116](adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md) (S3 multipart with part URLs signed by the API and Uppy in the browser), accepted on 2026-10-31 and proven against MinIO with a 4 GiB file that resumed after a cut link and a closed page. The platform is [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare for the web app, edge and storage, Modal for Python and GPUs, and Neon for Postgres. Work ran locally from 2026-10-08, and on 2026-10-31 the owner opened Modal, Neon and the Zitadel CI credentials again, on the condition that every cloud run costs as little as possible ([knowledge/platform.md](knowledge/platform.md)).

| Area | State |
|---|---|
| Repository and CI | pnpm and Turborepo monorepo with TypeScript 7 and Biome, Python 3.14 with uv ([ADR 0006](adr/0006-monorepo-tooling.md), [ADR 0007](adr/0007-python-tooling.md)). CI runs lint, types, unit, database, Playwright and a `formats` job over the slide fixture corpus behind `ci-ok`, plus docs and infra workflows. Commits follow Conventional Commits with the backlog ID ([ADR 0014](adr/0014-conventional-commits-and-releases.md)) |
| Stack (M0) | 20 of 40 STACK slots decided, the latest being report PDFs with Typst ([ADR 0083](adr/0083-typst-for-report-pdfs.md)). STACK-019 (Modal cold starts) and STACK-020 (Postgres hosting) can start now that the cloud is open |
| API foundations | Typed settings, RFC 9457 problems, an Orval client generated from OpenAPI, Postgres 17 with PostGIS behind PgBouncer, forced row-level security on every table, a table-driven isolation suite and JSON logs with PHI scrubbing |
| Identity | Zitadel login through a backend-for-frontend, workspaces as tenants, the researcher and reviewer roles with admin rights as a flag on a researcher and a permission on every route ([ADR 0096](adr/0096-researcher-and-reviewer-with-admin-rights.md)), built by IAM-024 (admin as a right of a researcher) and waiting for a green CI run on `main`, invitations, service accounts, idle lock and away status. Only workspace members reach workspace routes |
| Projects and cases | Projects with privacy modes, owners and roles ([ADR 0064](adr/0064-project-api.md), [ADR 0065](adr/0065-project-role-enforcement.md)), optional cases with patients only in clinical projects and a CSV import, emergency access, a class taxonomy and versioned opinion forms |
| Review loop (M3) | Annotations ([ADR 0076](adr/0076-annotation-and-ai-result-storage.md)), immutable result sets ([ADR 0077](adr/0077-result-sets.md)), review tasks that open task slides to their reviewers ([ADR 0078](adr/0078-review-task-model.md)), the reviewed layer ([ADR 0079](adr/0079-reviewed-layer.md)), verdicts and opinions ([ADR 0072](adr/0072-verdicts-reasons-and-opinion-forms.md)), derived states with stored moves, the disagreement queue with decisions and sign-off as the owner decided ([ADR 0080](adr/0080-disagreement-rule-and-sign-off.md)), My work ([ADR 0082](adr/0082-my-work-query-api.md)) and the task evaluation ([ADR 0084](adr/0084-evaluation-metrics.md)). See [knowledge/api.md](knowledge/api.md) and [knowledge/evaluation.md](knowledge/evaluation.md) |
| Ingest and results | A Postgres job engine with leases. `parfocal_ingest` identifies formats, checks integrity by structure without an antivirus ([ADR 0081](adr/0081-uploads-are-checked-by-structure.md)), builds the level table, renders thumbnails, extracts labels and macros, builds a tissue mask, reads GeoJSON, QuPath, CSV and mask results, and keeps IDs across result sets ([knowledge/slide-formats.md](knowledge/slide-formats.md), [knowledge/results.md](knowledge/results.md)). Cell chunks have a codec in `parfocal_common.cell_chunks`. The upload API of INGEST-001 (upload API with presigned multipart) creates, signs, lists, checks, completes and aborts multipart uploads against MinIO and queues the ingest job, and waits for INGEST-028 (upload protocol check on the R2 dev bucket) ([knowledge/uploads.md](knowledge/uploads.md)). The ingest steps do not read the uploaded file yet |
| Security and notifications | A hash-chained audit log with erasable pseudonyms, admin queries, a signed export and a re-anchor after purges, a data class on every column with a generated [data map](reference/data-map.md), envelope-encrypted patient identifiers with blind indexes, an Origin check on cookie writes, per-person and per-workspace rate limits, retention with legal holds through one database function, access export and erasure for people and patients, a [threat model](security/threat-model.md), and notifications from one catalogue with resolved targets, an email outbox and an inbox API with read state and mutes for a project, task or case, built by NOTIF-007 (inbox API) and waiting for a green CI run on `main` |
| Web | A Vite build with typed public config and no screens. The UI is not final, so screens wait |

Who is working on what, what is blocked and what is free to start is on the task board: run `pnpm board` ([board/README.md](board/README.md)).

Accounts and tools are listed in [knowledge/agent-tooling.md](knowledge/agent-tooling.md).

## Next up

No UI work until the owner says so. The cloud is open again since 2026-10-31, and every run must keep costs as low as possible ([knowledge/platform.md](knowledge/platform.md)).

1. Backend work that is still free: SET-001 (settings storage and resolution), AIP-008 (job model and API), GUIDE-013 (review order as a background job), TASK-007 (nudge, reassign and change a task), TASK-006 (invitations to a task), OBJ-003 (split, merge and added objects), REVIEW-010 (review decisions API, first check whether the reviewed layer already covers it), INGEST-017 (publish step and slide status) and SEC-009 (label and macro handling). REVIEW-000 (confidence rules) waits for AINUC-000 (pick detector and typer), and the browser-side confidence tasks (REVIEW-011 wording, REVIEW-018 zones) wait with the UI.
2. The owner should decide [ADR 0118](adr/0118-blinding-and-a-kept-first-read.md) (blinding and a kept first read): whether the first read hides all of the AI, as built, or only its claim with blind class picks, as POC doc 44 (round 6 working mock) draws it, and whether a reviewer who has seen others' work may still reopen.
3. EVAL-007 (study template model and API) is done, and its [ADR 0120](adr/0120-study-templates-are-workspace-rows-and-tasks-only-pin-them.md) (study templates as workspace rows that a task only pins) waits for the owner. It unblocks EVAL-008 (report from template blocks), and TASK-009 (study template in a new review task) and ADMIN-008 (report template library) wait with the UI.
4. Waiting for uploads to reach storage: INGEST-028 (upload protocol check on the R2 dev bucket), which needs the owner's yes for the `tofu apply` of the bucket CORS and lifecycle rules and then ticks INGEST-001 (upload API, built and in review), and after them wiring the ingest steps, writing imported objects into result sets, cell classes in the evaluation, object-level progress in My work, and deleting stored files in the retention purge.
5. Waiting for cloud work: the daily retention cron, SEC-027 (edge limits per IP), SEC-026 (isolated parsing, needs AIP-006) and every staging check.
6. Waiting for the final UI: every screen task, including the ones whose backend was split out (ADJ-002, GUIDE-007, EVAL-002, HOME-009), and the browser checks INGEST-009, INGEST-013 and INGEST-016.
7. Follow-ups from earlier decisions: the generated client's error type and options under `exactOptionalPropertyTypes` for STACK-008 (generated client), a browser check of the routing spike, and the OME-Zarr reader.
8. The owner should read [ADR 0053](adr/0053-ai-results-review-direction.md) and ADRs 0054 to 0091, which were accepted under standing approval on 2026-10-17 and 2026-10-18, except ADRs 0080, 0081, 0088, 0089 and 0090, which record the owner's own choices, and ADRs 0024 to 0051.
9. Unblocked by the owner on 2026-10-31: STACK-019 (the web framework, which measures Modal cold starts), STACK-020 (database hosting, which measures the Neon region) and IAM-001 (login provider set up from code). VIEW-054 (the JPEG 2000 slide in the viewer test set) adds both slides. FOUND-014 (dependency and licence scanning) is still on hold.

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
