# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-06

## Where we are now

The prototypes are approved for a production build and the planning is done. [BACKLOG.md](BACKLOG.md) holds 520 tasks in 37 epics from an empty repository to a pilot-ready product. The decisions taken during planning are recorded as the baseline in [ADR 0002](adr/0002-planning-baseline.md). The repository has docs only and no code yet. Nothing is committed.

## Next up

1. Milestone M0. Work through the STACK epic in [BACKLOG.md](BACKLOG.md), one ADR per slot, starting with the slots that block FOUND-001 (STACK-013 and STACK-018).
2. Then FOUND-001 to FOUND-003 to stand up the monorepo and the ADR check in CI.
3. STACK-031 (model licensing) is the largest open risk and can run in parallel.

## Index

| File | What it holds |
|---|---|
| [BACKLOG.md](BACKLOG.md) | Every task with checkboxes, the Definition of Done and the decisions baseline |
| [log.md](log.md) | Dated log of what was done |
| [project/overview.md](project/overview.md) | The product, users, scope, design sources and the POC's role |
| [project/roadmap.md](project/roadmap.md) | Milestones M0 to M6 and their status |
| [project/risks.md](project/risks.md) | Risk register |
| [project/poc-reference.md](project/poc-reference.md) | Where the POC lives, with full links to every POC doc |
| [adr/](adr/README.md) | Decision records |
| [results/](results/README.md) | Measurements, benchmarks, evaluations and studies |
| [knowledge/](knowledge/README.md) | Durable lessons and gotchas by topic |
