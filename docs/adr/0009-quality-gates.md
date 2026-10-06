# 0009. Quality gates: lefthook, betterleaks, type-aware Oxlint rules and solution-style tsconfigs

- Date: 2026-10-06
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: FOUND-006. Replaces the "Per package" row of [ADR 0008](0008-typescript-internal-packages.md).

## Context

FOUND-006 needs a hook runner that checks staged files with Biome, type-aware Oxlint, Ruff and a secret scanner, and CI must run the same checks. The owner asked for state-of-the-art tools. The versions were checked on 2026-10-06.

Running Oxlint in type-aware mode showed a gap in ADR 0008's layout. Each package's `tsconfig.json` covered only `src`, so Oxlint and editors typed test files without Node's types and reported false errors.

## Options considered

1. Hook runner: lefthook 2.1 (a single Go binary installed through npm, parallel jobs, glob filters, re-stages fixed files), pre-commit (Python-based, keeps its own tool environments), or husky with lint-staged (two packages, Node only).
2. Secret scanner: betterleaks 1.9 (by the gitleaks maintainers including its original author, better generic-secret detection, active, MIT), gitleaks 8.30 (most widely used, last release March 2026), or TruffleHog (strong verification, heavier).
3. Test file typing: one `tsconfig.json` per package covering `src` and tests with Node's types (Node globals leak into browser code), or a solution-style `tsconfig.json` with `"files": []` that references one config for `src`, one for tests and, in `viewer-engine`, one for web workers. The second is the layout Vite's templates use, and TypeScript 7 builds it with `tsc -b` when the sub-configs are not `composite`.

## Decision

| Concern | Choice |
|---|---|
| Hooks | lefthook, configured in `lefthook.yml`, installed by the root `prepare` script |
| Secret scanning | betterleaks 1.9 on staged changes in the hook and on the full history in CI, with output redacted. CI downloads the release and checks its SHA-256 |
| Type-aware lint | Oxlint `--type-aware` with only the rules typescript-eslint's "recommended type-checked" preset covers, plus `switch-exhaustiveness-check`, in `.oxlintrc.json`. `no-floating-promises` allows `node:test`'s `test`, `it`, `describe` and `suite` |
| Per-package tsconfig | `tsconfig.json` with `"files": []` and references to `tsconfig.src.json`, `tsconfig.test.json` and, in `viewer-engine`, `tsconfig.worker.json`. The `typecheck` script runs `tsc --noEmit -p` on each |
| CI | `pnpm secrets` and `pnpm check` (Biome, Oxlint, Ruff lint and format) before the typecheck and tests |

## Consequences

- Every developer machine needs betterleaks (`brew install betterleaks`). The hook fails without it.
- betterleaks v2 is in release candidates with CLI changes. Upgrade deliberately and update both `lefthook.yml` and the CI step.
- The solution-style config only routes editors and Oxlint to the right sub-config. Cross-package code sharing stays as ADR 0008 describes, without project references between packages.
- Tested on 2026-10-06: a staged fake Stripe key was blocked by the secrets job, a staged undefined name was blocked by Ruff (`F821`), a planted floating promise was reported by Oxlint, and a clean staged tree passed all four jobs.
