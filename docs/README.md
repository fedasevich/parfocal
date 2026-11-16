# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-11-15

## In progress

A cloud run on 2026-11-15 on the branch `claude/quirky-pascal-htseil` handed back 20 tasks without browser runs and touched no production, and the owner dropped staging for good ([ADR 0331](adr/0331-no-staging-environment.md), no staging environment). The branch is not merged to `main` yet. Two things come first now: SKEL-001 (production environment exists), which is in review with its production smoke check passing and one tenant still unverified, and TEST-044 (web specs green on the built app), where `font-preload.spec.ts` still fails on the built app. Most of the run's tasks sit in review until a green ci run confirms the specs they wrote. `python3 scripts/board.py brief` lists the claimed tasks and the review column.

The owner's open questions are decisions 105 to 110 and the Mac checks in [decisions.md](decisions.md), which starts with what to do next in order.

## Where we are now

Parfocal is an app for reviewing AI results on whole slides and annotating slides for training data ([ADR 0053](adr/0053-ai-results-review-direction.md), the AI results review direction). No count is written here. `python3 scripts/board.py counts` prints tasks and ticks per milestone gate and per epic.

| Area | State |
|---|---|
| Cloud | Open, with a standing yes for additive production writes inside $30 a month ([ADR 0151](adr/0151-standing-approval-for-production-within-30-dollars.md)). Production is the only cloud environment until the first real user ([ADR 0293](adr/0293-production-only-until-the-first-real-user.md)). SKEL-001 is open, and SEC-031's guard now refuses agents' destructive cloud actions ([knowledge/platform.md](knowledge/platform.md), [knowledge/agent-tooling.md](knowledge/agent-tooling.md)) |
| Repository and CI | pnpm and Turborepo with TypeScript and Biome, Python 3.14 with uv, tooling pins raised by FOUND-027. The web suite runs on a built app (FOUND-026), and `bash scripts/lead/ci.sh` prints the result ([knowledge/tooling.md](knowledge/tooling.md)) |
| Viewer, tiles and ingest (M2) | Viv reads every POC format natively, including NDPI, BIF, Philips, OME-Zarr and JPEG 2000, which stays native ([knowledge/slide-formats.md](knowledge/slide-formats.md)). The deck.gl WebGPU route matches Viv's goldens and a developer setting picks the route. The custom WebGPU route lacks culling and detail tiers (VIEW-073), and per-format CI budgets exist ([knowledge/viewer-build.md](knowledge/viewer-build.md)) |
| Annotation path (MA) | The tasks [ADR 0237](adr/0237-annotate-tasks-on-one-shared-layer.md) lists are ticked except PILOT-005 (moderated usability study, second round) |
| Review loop (M3) | Built, from result sets and heatmaps to guided review and decisions. The screens run on fake data through MSW ([ADR 0135](adr/0135-fake-data-through-the-api-client-with-msw.md)), and every screen string is translatable (I18N) |
| AI runs (M4) | Model runs, layers, heatmaps with pyramid export, interactive segmentation, streamed nuclei, a registry table with a per-task promotion gate and a server patch service. Tumor maps are barely started |
| Learning and evaluation (M5, M6) | The learner corrects types in the browser, and per-tenant training rounds pool reviewed nuclei on the server and promote through the gate. The Modal pooling job is not built ([knowledge/evaluation.md](knowledge/evaluation.md)) |
| Security and pilot (M6) | Row-level security, a hash-chained audit log, isolated parsing of uploads in a child process (SEC-026, sandbox in SEC-045) and the [threat model](security/threat-model.md). The OPS cloud parts are open |

Tasks in the review column wait for an owner look, a cloud step or another task, and [decisions.md](decisions.md) says what each one waits for.

## Next up

1. TEST-044 (web specs green on the built app) and TEST-043 (the sidecar open check does not depend on machine load).
2. SKEL-001 (production environment exists) is in review after its production smoke check, and SKEL-009 (CI deploys main to production) follows it.
3. VIEW-073 (finish the custom WebGPU route): compute culling and detail tiers.
4. SEC-045 (isolate the remaining parse steps and run them in a Modal sandbox).
5. FOUND-035 (squash the migrations into one baseline) before any shared database.
6. FOUND-036 (split the largest source files) while no agent works in them.
7. AITUM-001 (tumor map job) and MLEVAL-005 (tumor map evaluation), which the promotion gate waits for.
8. PILOT-004 (pilot data onboarding) for the thesis slice.

## Index

| File | What it holds |
|---|---|
| [BACKLOG.md](BACKLOG.md) | Every task with checkboxes, the Definition of Done and the decisions baseline |
| [log.md](log.md) | Dated log of what was done |
| [decisions.md](decisions.md) | Open questions for the owner, each with options, the recommended one and a blank line for the owner's choice |
| [board/](board/README.md) | The live task board over the backlog, with one claim file per task being worked on (`pnpm board`) |
| [project/overview.md](project/overview.md) | The product, users, scope, the React app as the design source and the POC's role |
| [project/roadmap.md](project/roadmap.md) | The milestones, M0 to M6 with MA (the annotation path), and their status |
| [project/risks.md](project/risks.md) | Risk register |
| [project/poc-reference.md](project/poc-reference.md) | Where the POC lives, with full links to every POC doc |
| [project/agent-stand-in-records.md](project/agent-stand-in-records.md) | Every record where an agent stood in for a pathologist, counsel, a reviewer, a user or the owner, and what a real check needs |
| [project/standing-approval-records.md](project/standing-approval-records.md) | One page on the records accepted under standing approval, ADR 0054 to ADR 0091 |
| [design/](design/README.md) | The frozen round 6 hi-fi mock and UX kit, with their artifact versions and what was left out |
| [design/prototype-inventory.md](design/prototype-inventory.md) | Every mock screen and scene and every kit page, with the PROTO task that builds it, its owner and the API it reads |
| [adr/](adr/README.md) | Decision records |
| [results/](results/README.md) | Measurements, benchmarks, evaluations and studies |
| [knowledge/](knowledge/README.md) | Durable lessons and gotchas by topic |
| [reference/permissions.md](reference/permissions.md) | The role and permission matrix, generated from the API code |
| [security/threat-model.md](security/threat-model.md) | STRIDE threat model for upload, tile access, guest links, AI jobs and realtime, with the task that mitigates each high risk |
| [compliance/controls.md](compliance/controls.md) | Control matrix mapping GDPR articles, HIPAA Security Rule safeguards and ISO 27001:2022 Annex A controls to backlog tasks, with gaps |
| [compliance/records-of-processing.md](compliance/records-of-processing.md) | GDPR Article 30 records of processing, as controller and as processor |
| [compliance/dpia-ai-results-review.md](compliance/dpia-ai-results-review.md) | Data protection impact assessment for AI-assisted review of whole slides |
| [compliance/dpa-template.md](compliance/dpa-template.md) | Article 28 data processing agreement template for workspaces |
| [compliance/subprocessors.md](compliance/subprocessors.md) | Services that process personal data, where the data sits and their contract status |
| [compliance/cookies-and-storage.md](compliance/cookies-and-storage.md) | Cookie and consent policy: every cookie and browser storage key, and why no consent banner is shown |
| [compliance/incident-response.md](compliance/incident-response.md) | Incident response and breach notification runbook, with alert channels and the owner's contact checklist |
| [compliance/incident-register.md](compliance/incident-register.md) | Register of incidents and breaches under GDPR Art. 33(5), with its entry template |
| [compliance/tabletop-exercise.md](compliance/tabletop-exercise.md) | Ready-to-run tabletop scenario for the runbook and the record of each run |
| [reference/parfocal-results-v1.md](reference/parfocal-results-v1.md) | The Parfocal results file: its fields, how to check a file and the validator's error codes, with the [schema](reference/parfocal-results-v1.schema.json) and a [template](reference/parfocal-results-v1.template.json) |
| [reference/data-map.md](reference/data-map.md) | The data class of every database column, generated from the table models |
