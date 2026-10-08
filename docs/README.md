# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-06

## Where we are now

The prototypes are approved for a production build and the planning is done. [BACKLOG.md](BACKLOG.md) holds 536 tasks in 37 epics from an empty repository to a pilot-ready product. The decisions taken during planning are recorded as the baseline in [ADR 0002](adr/0002-planning-baseline.md). The platform is decided in [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare for the web app, edge and storage, Modal for Python and GPUs, and Neon for Postgres. The pilot uses public slides with fake identities and optimises for cost. The STACK slots now carry these defaults but each still needs its spike. The repository `fedasevich/parfocal` holds the monorepo skeleton (FOUND-001), with pnpm, Turborepo, TypeScript 7 and Biome on the TypeScript side and Python 3.14 with uv on the Python side ([ADR 0006](adr/0006-monorepo-tooling.md), [ADR 0007](adr/0007-python-tooling.md)). Three CI workflows check the docs, the infra code and the workspace. The API has typed settings, client selection by `APP_ENV` and RFC 9457 errors, and the web app has a Vite build with typed public config, but there are no features yet. The accounts are provisioned and listed in [knowledge/agent-tooling.md](knowledge/agent-tooling.md).

## Next up

The owner asked for the walking skeleton's backend and infrastructure next, without UI work, because the UI is not final.

1. STACK-008 waits for [ADR 0017](adr/0017-orval-api-client.md) (Orval) to be accepted. STACK-019 is blocked until the Modal spend limit is raised, then needs its cold-start and latency numbers. FOUND-008 can start once ADR 0017 is accepted.
2. STACK-020 (database, ORM, migrations and row-level security on Neon) needs Neon credentials or Docker running, then FOUND-013. FOUND-010 and FOUND-012 are done. FOUND-019 (error toasts) waits for the final UI.
3. STACK-028 and STACK-023, then IAM-001 to IAM-003 and CASES-001 for SKEL-002 and SKEL-003.
4. OPS-001 (DNS, Neon and the policy check are left) and OPS-002 for SKEL-001.
5. STACK-031 (model licensing) is the largest open risk and can run in parallel. FOUND-014 is on hold.

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
