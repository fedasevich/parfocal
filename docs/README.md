# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-11-24

## In progress

State on 2026-11-24. `app.parfocal.eu` runs v0.51.0 in Europe and is a development environment that agents may reseed ([ADR 0390](adr/0390-app-parfocal-eu-is-a-development-environment.md), the deployed app is dev). Agents sign in there with `scripts/agent_session.py`, run the deployed checks themselves and tick tasks on them. The lead fixed main CI on 2026-11-24, and its run was not finished at consolidation. `python3 scripts/board.py brief` lists the claimed tasks and the review column.

The owner's open steps and questions are in [decisions.md](decisions.md), which starts with what to do next in order. Answered decisions move to [decisions-answered.md](decisions-answered.md).

## Where we are now

Parfocal reviews AI results on whole slides and annotates slides for training data ([ADR 0053](adr/0053-ai-results-review-direction.md), the AI results review direction). `python3 scripts/board.py counts` prints tasks and ticks per milestone gate and per epic. The review loop (M3), AI runs (M4) and collaboration and evaluation (M5) have every gate task ticked.

| Area | State |
|---|---|
| Cloud | Production is the only cloud environment, with a standing yes for additive writes inside $30 a month ([ADR 0151](adr/0151-standing-approval-for-production-within-30-dollars.md)). Deploys are cut by hand with `pnpm release` and `deploy.yml`, and CI deploys on main are on hold (SKEL-009, OPS-005) ([knowledge/deploy.md](knowledge/deploy.md)) |
| Viewer (M2) | Viv reads every POC format natively ([knowledge/slide-formats.md](knowledge/slide-formats.md)). Open are the hardware checks at the owner's Mac (VIEW-021, VIEW-052, DEV-013) and a CDN in front of slide storage (TILES-002) |
| Review, annotate and AI | Built and walked on the deployed app with real model results, from upload through review, adjudication, sign-off and a frozen dataset. Whole slide runs wait for a free L4, which PROTO-168 measured at 29.6 minutes |
| Guided tour | 16 chapters ring every control across the six role accounts, switching account through a flagged server switch ([ADR 0437](adr/0437-the-guided-tour-switches-to-role-accounts-on-the-dev-app.md)) |
| Usability study | Round 5 runs for a participant in one tab, uploads traces to the API, measures as round 4 did, and the console prepares a participant project through the seed function ([ADR 0439](adr/0439-the-console-prepares-a-participant-through-the-seed-function.md), [project/study-round-5.md](project/study-round-5.md)) |
| Security and pilot (M6) | Row-level security, a hash-chained audit log, sandboxed parsing and an agent guard. Backups, observability, alerting and production readiness are on hold by the owner's answers |

## Next up

1. PROTO-168 (a queued whole slide run starts in time), after the owner's decision on a bigger GPU fallback.
2. The ui visual goldens refresh with the `update_goldens` CI run, then a green main CI.
3. PILOT-005 (moderated usability study, second round), the last open task of the annotation path.
4. PROTO-129 (the overview map marker follows the camera on every slide).
5. OPS-036 (view maps and tumor maps open a seeded slide from the folder beside its original).
6. OPS-009 (storage lifecycle and cost controls): the R2 lifecycle drill and a first live cost report.
7. TEST-010 (load test tooling): an agent mints the read-only load token that decision 124 (a load workflow token, option A) asked for, now that deploys run.
8. OPS-014 (prepare production for the first real user), which removes the tour switch and the seed secret.

## Index

| File | What it holds |
|---|---|
| [BACKLOG.md](BACKLOG.md) | Every task with checkboxes, the Definition of Done and the decisions baseline |
| [log.md](log.md) | Dated log of what was done |
| [decisions.md](decisions.md) | Only what is open for the owner: today's steps, open questions and what the review column waits for |
| [decisions-answered.md](decisions-answered.md) | Every answered decision and what it changed, newest first |
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
