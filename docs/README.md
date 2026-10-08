# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-06

## Where we are now

The prototypes are approved for a production build and the planning is done. [BACKLOG.md](BACKLOG.md) holds 535 tasks in 37 epics from an empty repository to a pilot-ready product. The decisions taken during planning are recorded as the baseline in [ADR 0002](adr/0002-planning-baseline.md). The platform is decided in [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare for the web app, edge and storage, Modal for Python and GPUs, and Neon for Postgres. The pilot uses public slides with fake identities and optimises for cost. The STACK slots now carry these defaults but each still needs its spike. The repository `fedasevich/parfocal` holds the monorepo skeleton (FOUND-001), with pnpm, Turborepo, TypeScript 7 and Biome on the TypeScript side and Python 3.14 with uv on the Python side ([ADR 0006](adr/0006-monorepo-tooling.md), [ADR 0007](adr/0007-python-tooling.md)). Three CI workflows check the docs, the infra code and the workspace. There is no feature code yet. The accounts are provisioned and listed in [knowledge/agent-tooling.md](knowledge/agent-tooling.md).

## Next up

1. FOUND-001 to FOUND-007 are done. FOUND-018 (contract check and image builds in CI) waits for FOUND-008 and FOUND-015.
2. FOUND-016 (shared test fixtures) is done. FOUND-017 (release versioning) is built and waits for [ADR 0014](adr/0014-conventional-commits-and-releases.md) to be accepted. FOUND tasks without open dependencies: FOUND-009 (local development) and FOUND-010 (configuration). FOUND-014 is on hold.
3. The remaining M0 STACK slots. STACK-001 waits for [ADR 0015](adr/0015-vite-build-tool.md) to be accepted. Next are STACK-002 and STACK-008, then the platform spikes that can overturn ADR 0003 (STACK-019, STACK-020, STACK-025).
4. STACK-031 (model licensing) is the largest open risk and can run in parallel.

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
