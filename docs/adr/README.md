# Decision records

One file per decision, numbered in order. Copy [0000-template.md](0000-template.md) to start a new one. Accepted records are never rewritten. A change of course gets a new record that supersedes the old one.

Status is one of `Proposed`, `Accepted`, `Rejected` or `Superseded by NNNN`.

| # | Decision | Status | Date |
|---|---|---|---|
| [0001](0001-docs-as-project-memory.md) | Keep project memory in `docs/` and share one agent guide | Accepted | 2026-10-06 |
| [0002](0002-planning-baseline.md) | Adopt the planning-session decisions as the baseline | Accepted | 2026-10-06 |
| [0003](0003-pilot-platform-architecture.md) | Pilot platform architecture on Cloudflare, Modal and Neon | Accepted | 2026-10-06 |
| [0004](0004-cloud-dev-resources.md) | Use free cloud resources in development instead of local emulators (replaces rule 5 of 0003) | Accepted | 2026-10-06 |
| [0005](0005-external-sends-only-in-production.md) | Send email, telemetry and analytics only from production (replaces four rows of 0004) | Accepted | 2026-10-06 |
| [0006](0006-monorepo-tooling.md) | Monorepo tooling: pnpm, Turborepo, TypeScript 7, Biome and type-aware Oxlint | Accepted | 2026-10-06 |
| [0007](0007-python-tooling.md) | Python 3.14 with uv, Ruff, basedpyright and pytest | Accepted | 2026-10-06 |
| [0008](0008-typescript-internal-packages.md) | TypeScript packages share source instead of project references | Accepted | 2026-10-06 |
| [0009](0009-quality-gates.md) | Quality gates: lefthook, betterleaks, type-aware Oxlint rules and solution-style tsconfigs | Accepted | 2026-10-06 |
| [0010](0010-ci-runners-and-suites.md) | GitHub Actions with hosted runners and a nightly self-hosted Mac GPU runner | Superseded by 0011 | 2026-10-06 |
| [0011](0011-hosted-ci-only.md) | Hosted CI runners only, no GPU-heavy test suites | Accepted | 2026-10-06 |
| [0012](0012-ux-round-2-prototype-revisions.md) | Prototype round 2: staging-first findings, quiet top bar, upload window and clearer compare | Accepted | 2026-10-07 |
| [0013](0013-cell-findings-shortcuts-and-ai-on-upload.md) | Prototype round 3: cell findings from zones of unsure cells, a neutral unsure colour, a shortcut editor and AI steps on upload | Accepted | 2026-10-07 |
| [0014](0014-conventional-commits-and-releases.md) | Conventional Commits with backlog scopes, and releases cut locally with git-cliff | Accepted | 2026-10-08 |
| [0015](0015-vite-build-tool.md) | Vite 8 as the build tool and dev server | Accepted | 2026-10-08 |
| [0016](0016-react-19-spa-compiler-strictmode.md) | React 19 SPA with React Compiler, and StrictMode around the viewer | Accepted | 2026-10-08 |
| [0017](0017-orval-api-client.md) | Orval generates the typed API client from FastAPI's OpenAPI 3.1 | Accepted | 2026-10-08 |
