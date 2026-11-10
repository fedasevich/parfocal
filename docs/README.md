# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-11-09

## In progress

The annotation path (milestone MA) comes first, in the order [ADR 0237](adr/0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer) lists. Next to it run the follow-up tasks of the four reviews of 2026-11-09: the [project review](results/2026-11-09-project-review.md), the [tenant isolation review](results/2026-11-09-tenant-isolation-review.md), the [edge token review](results/2026-11-09-edge-token-review.md) and the [viewer engine review](results/2026-11-09-viewer-engine-review.md). `python3 scripts/board.py brief` lists the claimed tasks and the review column.

The owner's open questions in [decisions.md](decisions.md) are decision 81 (staging before more features), decision 82 (what the thesis claims about people), decision 83 (a date for the thesis slice), decision 84 (a new workspace and its mail domain), decision 85 (presence in a blinded review) and decision 86 (how fast the database tests must be).

## Where we are now

Parfocal is an app for reviewing AI results on whole slides and annotating slides for training data ([ADR 0053](adr/0053-ai-results-review-direction.md), the AI results review direction). No count is written here. `python3 scripts/board.py counts` prints tasks and ticks in total, per milestone gate and per epic.

| Area | State |
|---|---|
| Cloud | Open, with a standing yes for additive production writes inside $30 a month ([ADR 0151](adr/0151-standing-approval-for-production-within-30-dollars.md)). No environment serves the app. SKEL-001 (staging environment exists) and OPS-001 (base infrastructure as code) are open, and the cloud has run only spikes and checks so far, such as the [upload protocol check on the R2 dev bucket](results/2026-11-02-upload-protocol-check-on-r2.md) ([knowledge/platform.md](knowledge/platform.md)) |
| Repository and CI | pnpm and Turborepo with TypeScript and Biome, Python 3.14 with uv. `ci` with the docs checks under `ci-ok`, and `security`, run on every push to `main`, and `bash scripts/lead/ci.sh` prints the result ([knowledge/tooling.md](knowledge/tooling.md)) |
| Viewer, tiles and ingest (M2) | Viv draws the formats built so far through decode workers and a byte cache, checked by golden images, with signed tile access through the Worker. The format tasks still open are VIEW-013 (NDPI including above 4 GB), VIEW-014 (Ventana BIF with frame stitching), VIEW-016 (Philips TIFF, Huron and ARGOS) and VIEW-017 (OME-Zarr v0.4 and v0.5 sharded), and the alternate renderers are not started ([knowledge/viewer-build.md](knowledge/viewer-build.md), [knowledge/slide-formats.md](knowledge/slide-formats.md), [knowledge/uploads.md](knowledge/uploads.md)) |
| Annotation path (MA) | Of the tasks [ADR 0237](adr/0237-annotate-tasks-on-one-shared-layer.md) lists, the annotate task, the shared layer, drawing, threads and the one-click tools are ticked. Open are COLLAB-016 (calm live updates on a shared layer, in progress), AINUC-013 (stream a whole-slide run onto the open slide), AINUC-010 (whole-slide nuclei job UI), JOBS-007 (run a model on a selection in Annotate) and PILOT-005 (moderated usability study, second round) |
| Review loop (M3) | Backend and screens are built, from result sets and review tasks to guided review, decisions, opinion forms, My work and settings. The screens run on fake data through MSW ([ADR 0135](adr/0135-fake-data-through-the-api-client-with-msw.md)), and TEST-026 (core browser specs against the real API) is open |
| AI runs (M4) | Model runs with the jobs tray, layers, heatmaps and the object table, interactive segmentation and nuclei work, with the ML pool as the only Modal app. Tumor maps have barely started |
| Collaboration and evaluation (M5) | Threads, presence, compare, the disagreement queue with sign-off, the evaluation report and the admin screens are built ([knowledge/evaluation.md](knowledge/evaluation.md)). Remote sources are not started |
| Security and pilot (M6) | Forced row-level security with a role check at startup, a hash-chained audit log, encrypted patient identifiers, retention and erasure, and the [threat model](security/threat-model.md). The cloud parts of the controls and the OPS epic (infrastructure and operations) are open |
| Agent workflow | `board.py` is the way into the backlog and log. Parallel runs build in worktrees and land through the lead worktree with `scripts/lead/` ([knowledge/agent-workflow.md](knowledge/agent-workflow.md)) |

Tasks in the review column wait for an owner look or a cloud step, and [decisions.md](decisions.md) says what each one waits for.

## Next up

1. The owner answers the five open decisions, with decision 81 (staging before more features) first.
2. Staging: OPS-001 (base infrastructure as code), then SKEL-001 (staging environment exists), which every unproven cloud behaviour waits for.
3. The annotation path (milestone MA) in the order ADR 0237 (annotate tasks on one shared layer) lists.
4. SEC-031 (hard stops for destructive agent actions), then the open VIEW and SEC tasks from the reviews of 2026-11-09.
5. FOUND-024 (rename verdict to decision everywhere), then FOUND-035 (squash the migrations into one baseline), both before any shared database.
6. TEST-027 (database tests in parallel) and TEST-026 (core browser specs against the real API).
7. The cloud numbers STACK-019 (web framework, Modal cold starts) and STACK-020 (database hosting, the Neon measurement) still wait for.
8. PILOT-004 (pilot data onboarding) and PROTO-010 (make the React app the design source) for the thesis slice.

## Index

| File | What it holds |
|---|---|
| [BACKLOG.md](BACKLOG.md) | Every task with checkboxes, the Definition of Done and the decisions baseline |
| [log.md](log.md) | Dated log of what was done |
| [decisions.md](decisions.md) | Open questions for the owner, each with options, the recommended one and a blank line for the owner's choice |
| [board/](board/README.md) | The live task board over the backlog, with one claim file per task being worked on (`pnpm board`) |
| [project/overview.md](project/overview.md) | The product, users, scope, design sources and the POC's role |
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
