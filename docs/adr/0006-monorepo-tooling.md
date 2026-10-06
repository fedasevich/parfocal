# 0006. Monorepo tooling: pnpm, Turborepo, TypeScript 7, Biome and type-aware Oxlint

- Date: 2026-10-06
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-013. Touches FOUND-001, FOUND-004, FOUND-006 and FOUND-007.

## Context

STACK-013 picks the package manager, the task runner and the lint and format tools for a monorepo that holds TypeScript (`apps/web`, `apps/edge`, `packages/*`) and Python (`apps/api`, `workers/*`). The backlog default was pnpm with Turborepo, Biome for format and lint, and typescript-eslint for type-aware rules Biome lacks. It must also say how Python tasks join the task graph and how CI caches work.

The check on 2026-10-06 ([result](../results/2026-10-06-tooling-spike.md)) found that TypeScript 7.0.2, the native compiler, is the current release, and that typescript-eslint 8.71.1 only supports TypeScript below 6.1.

## Options considered

1. pnpm, Turborepo, TypeScript 6, Biome and typescript-eslint (the backlog default). Proven, but it pins the repository to the last JavaScript-based compiler and runs two linters with different speeds and configs.
2. pnpm, Turborepo, TypeScript 7, Biome for format and lint, and Oxlint in type-aware mode only for the rules that need types. Fast type checking and linting. Oxlint's type-aware engine (`oxlint-tsgolint`) is built on TypeScript 7 and caught a floating promise in the spike. It is newer than typescript-eslint and has fewer type-aware rules.
3. Nx or Moon instead of Turborepo. Both handle polyglot graphs, but Nx brings far more framework than one developer needs, and Moon's smaller ecosystem gives little over Turborepo for this repository.

## Decision

Option 2.

| Concern | Choice |
|---|---|
| Package manager | pnpm 12 workspaces, pinned through `packageManager` in the root `package.json` |
| Task runner | Turborepo 2 |
| Type checking | TypeScript 7 (`tsc --noEmit` per package) |
| Format and lint | Biome 2 for both, one root `biome.json` |
| Type-aware lint | Oxlint with `--type-aware`, enabling only type-aware rules such as `no-floating-promises` and `no-misused-promises`, so it does not duplicate Biome |

Python tasks join the graph through a small `package.json` in each Python package whose scripts call uv, for example `"test": "uv run --package api pytest"`. Their Turborepo `inputs` include the package sources and the root `uv.lock`. The root `pyproject.toml` defines a uv workspace, decided in [ADR 0007](0007-python-tooling.md).

CI caching on GitHub Actions:

| Cache | How |
|---|---|
| pnpm store | `actions/setup-node` with `cache: pnpm` |
| uv cache | `astral-sh/setup-uv` with `enable-cache: true` |
| Turborepo | `actions/cache` on `.turbo/cache`, keyed by the commit SHA with a prefix restore key |

Vercel's free Remote Cache stays an option if the GitHub cache becomes too slow. Turborepo telemetry is turned off with `TURBO_TELEMETRY_DISABLED=1`.

## Consequences

- `.gitignore` must keep `node_modules/`, `.turbo/`, `__pycache__/`, `.pytest_cache/` and `.venv/` ignored. Turborepo hashes every file git does not ignore, and the spike missed the cache until these were ignored.
- typescript-eslint and ESLint are not used. If a needed type-aware rule is missing from Oxlint, revisit with a new ADR.
- Some tools call the TypeScript compiler API (OpenAPI client generators, Storybook docgen). They may need their own TypeScript 6 dependency next to the repository's TypeScript 7. TODO: check in STACK-008 and STACK-012.
- FOUND-001 sets up the root `package.json`, `pnpm-workspace.yaml`, `turbo.json` and `biome.json`. FOUND-004 uses TypeScript 7. FOUND-006 runs Biome and Oxlint in pre-commit. FOUND-007 uses the cache table above.
