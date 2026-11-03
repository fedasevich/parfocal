# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-18

## In progress

The PROTO screen tasks (the mock ported into React over fake data) are built, pushed and in review. They wait for the owner to compare them with the frozen mock, which decision 15a (owner review of each ported screen group) in [decisions.md](decisions.md) asks about. PROTO-010 (make the React app the design source) waits until all of them are ticked. `python3 scripts/board.py brief` lists them.

Only the owner touches `docs/decisions.md` in the main tree, where their answers sit uncommitted. Agents sharing one working tree commit through a private git index, because the lint hook re-stages whole files ([knowledge/frontend-ui.md](knowledge/frontend-ui.md)).

## Where we are now

Parfocal is an AI results review app since 2026-10-17 ([ADR 0053](adr/0053-ai-results-review-direction.md), the AI results review direction). The backlog holds 796 tasks in 53 epics, and about 170 are ticked.

| Area | State |
|---|---|
| Platform | Cloudflare, Modal and Neon ([ADR 0003](adr/0003-pilot-platform-architecture.md)). The cloud is open since 2026-10-31 on the condition that every run costs as little as possible ([knowledge/platform.md](knowledge/platform.md)) |
| Repository and CI | pnpm and Turborepo with TypeScript 7 and Biome, Python 3.14 with uv, CI behind `ci-ok` ([knowledge/tooling.md](knowledge/tooling.md)) |
| Stack (M0) | 20 of 40 STACK slots decided |
| API and identity | Problem details, an Orval client, Postgres with forced row-level security, Zitadel login through a backend-for-frontend and the researcher and reviewer roles ([knowledge/api.md](knowledge/api.md), [knowledge/auth.md](knowledge/auth.md)) |
| Review loop (M3) | The backend is built end to end, from result sets and review tasks to disagreements, sign-off, My work and the evaluation metrics ([knowledge/evaluation.md](knowledge/evaluation.md)). Its screens come with the PROTO port |
| Ingest and results | Resumable uploads on S3 multipart ([ADR 0116](adr/0116-resumable-uploads-with-s3-multipart-and-uppy.md)), an ingest worker that publishes a slide, and result imports into cell chunks in object storage ([knowledge/uploads.md](knowledge/uploads.md), [knowledge/results.md](knowledge/results.md)) |
| Security | A hash-chained audit log, the [data map](reference/data-map.md), encrypted patient identifiers, rate limits, retention and erasure, and the [threat model](security/threat-model.md) |
| Web | React 19 with TanStack Router and Query, fake data through MSW ([ADR 0135](adr/0135-fake-data-through-the-api-client-with-msw.md)) and shadcn on Base UI with Tailwind v4 ([ADR 0130](adr/0130-shadcn-ui-on-base-ui-with-tailwind-v4.md)) |
| Agent workflow | `board.py` is the way into the backlog and log, with budgets for output, turns and screenshots ([ADR 0136](adr/0136-lean-agent-workflow.md), [knowledge/agent-workflow.md](knowledge/agent-workflow.md)) |

Several built tasks wait for a green CI run on `main` or for an owner decision. The board shows them (`pnpm board`). Accounts and tools are in [knowledge/agent-tooling.md](knowledge/agent-tooling.md).

## Next up

1. The owner answers [decisions.md](decisions.md) and reviews the PROTO screens. Choices that differ from what was built come first.
2. Free backend work, listed by `board.py ready`, such as JOBS-001 (model run API) and SET-001 (settings storage and resolution).
3. INGEST-028 (upload protocol check on the R2 dev bucket) needs the owner's yes for a `tofu apply`.
4. Cloud checks that can start: STACK-019 (Modal cold starts) and STACK-020 (the Neon region).
5. Measure tokens per finished task under the lean workflow and compare with ADR 0136 (a lean agent workflow).

## Index

| File | What it holds |
|---|---|
| [BACKLOG.md](BACKLOG.md) | Every task with checkboxes, the Definition of Done and the decisions baseline |
| [log.md](log.md) | Dated log of what was done |
| [decisions.md](decisions.md) | Open questions for the owner, each with options, the recommended one and a blank line for the owner's choice |
| [board/](board/README.md) | The live task board over the backlog, with one claim file per task being worked on (`pnpm board`) |
| [project/overview.md](project/overview.md) | The product, users, scope, design sources and the POC's role |
| [project/roadmap.md](project/roadmap.md) | Milestones M0 to M6 and their status |
| [project/risks.md](project/risks.md) | Risk register |
| [project/poc-reference.md](project/poc-reference.md) | Where the POC lives, with full links to every POC doc |
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
