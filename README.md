# Parfocal

Parfocal (`parfocal.eu`) is a multi-tenant cloud platform for pathologists covering whole-slide viewing, AI-assisted review and annotation, collaboration, reporting and sign-out.

The project memory lives in [docs/](docs/README.md). The plan is [docs/BACKLOG.md](docs/BACKLOG.md). Agents and contributors follow [AGENTS.md](AGENTS.md), which [CLAUDE.md](CLAUDE.md) imports.

## Layout

| Path | Language | Contents |
|---|---|---|
| `apps/web` | TypeScript | The pathologist web app (React SPA) |
| `apps/edge` | TypeScript | Cloudflare Worker router, tile gateway and Durable Objects |
| `apps/api` | Python | FastAPI backend, deployed on Modal |
| `workers/ingest` | Python | Slide validation, indexing and thumbnails |
| `workers/ml` | Python | GPU inference and training jobs |
| `packages/viewer-engine` | TypeScript | Framework-free viewer engine |
| `packages/ui` | TypeScript | Shared React components |
| `packages/api-client` | TypeScript | Client generated from the API's OpenAPI schema |
| `packages/tokens` | TypeScript | Design tokens |
| `packages/test-fixtures` | TypeScript | Slide fixtures and fetch scripts |
| `packages/typescript-config` | TypeScript | Shared tsconfig presets for browser, web worker, Node and Cloudflare code |
| `packages/py-common` | Python | Shared settings, logging, tenancy context and audit helpers |
| `infra/tofu` | OpenTofu | Cloudflare and Zitadel resources ([runbook](docs/knowledge/infra.md)) |
| `scripts` | Python | Repository checks such as the ADR check |
| `docs` | Markdown | Project memory |

## Getting started

Needs Node 26, pnpm 12, uv and Docker. Python 3.14 is fetched by uv.

```
pnpm install
uv sync --all-packages
pnpm test
pnpm typecheck
pnpm check
```

`pnpm check` runs Biome, Ruff lint and the Ruff format check. `pnpm typecheck` runs TypeScript and basedpyright in every package, strict for `apps/api` and `packages/py-common` and standard for `workers/*`. `pnpm test` runs Node's test runner and pytest. `uv run pytest` also runs every Python test from the root. The tools are chosen in [ADR 0006](docs/adr/0006-monorepo-tooling.md), [ADR 0007](docs/adr/0007-python-tooling.md) and [ADR 0008](docs/adr/0008-typescript-internal-packages.md). Turborepo runs the TypeScript and Python tasks in one graph. Each Python package has a small `package.json` whose scripts call uv.
