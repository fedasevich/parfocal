# Project docs

Start here. Every file in `docs/` is listed below, and agents keep this index current. See [AGENTS.md](../AGENTS.md) for how these files are maintained.

Last consolidated: 2026-10-06

## Where we are now

The prototypes are approved for a production build and the planning is done. [BACKLOG.md](BACKLOG.md) holds 536 tasks in 37 epics from an empty repository to a pilot-ready product. The decisions taken during planning are recorded as the baseline in [ADR 0002](adr/0002-planning-baseline.md). The platform is decided in [ADR 0003](adr/0003-pilot-platform-architecture.md): Cloudflare for the web app, edge and storage, Modal for Python and GPUs, and Neon for Postgres. The pilot uses public slides with fake identities and optimises for cost. The STACK slots now carry these defaults but each still needs its spike. The repository `fedasevich/parfocal` holds the monorepo skeleton (FOUND-001), with pnpm, Turborepo, TypeScript 7 and Biome on the TypeScript side and Python 3.14 with uv on the Python side ([ADR 0006](adr/0006-monorepo-tooling.md), [ADR 0007](adr/0007-python-tooling.md)). Three CI workflows check the docs, the infra code and the workspace. The API has typed settings, client selection by `APP_ENV` and RFC 9457 errors, and the web app has a Vite build with typed public config, but there are no features yet. The accounts are provisioned and listed in [knowledge/agent-tooling.md](knowledge/agent-tooling.md).

## Next up

Work stays local until the owner fixes the cloud side. No Modal, Neon, staging or production changes, see [knowledge/platform.md](knowledge/platform.md). The UI is not final, so no UI work either.

1. STACK-020 against local Postgres with PostGIS and PgBouncer in Docker, standing in for Neon and its pooler. The Neon region check stays `TODO`. Then FOUND-013.
2. STACK-028 and STACK-023, then IAM-003 and CASES-001 against the local database. IAM-001 and IAM-002 need Zitadel and wait for the owner.
3. STACK-019 needs a Modal run for its cold-start numbers and waits for the owner. FOUND-014 is on hold, and FOUND-019 waits for the final UI.

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
