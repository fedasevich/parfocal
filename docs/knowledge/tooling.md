# Repository tooling

Lessons about pnpm, Turborepo, Biome, TypeScript and uv in this monorepo. The choices are in [ADR 0006](../adr/0006-monorepo-tooling.md) and [ADR 0007](../adr/0007-python-tooling.md).

## Turborepo edits AGENTS.md unless told not to

Turborepo 2.11 detects AI agents and writes a managed "turborepo-agent-rules" block into `AGENTS.md` before repository commands. That file is the shared agent guide and only the owner changes it. `turbo.json` sets `"agentGuidance": false`, which stops new blocks, and the block that was already added was deleted by hand. Do not remove that setting. Source: FOUND-001 log entry.

## Ignored caches keep Turborepo hits stable

Turborepo hashes every file in a package that git does not ignore. `__pycache__/`, `.pytest_cache/`, `.venv/` and `.turbo/` must stay in `.gitignore`, or Python tasks miss the cache on every run. Source: [tooling spike](../results/2026-10-06-tooling-spike.md).

## TypeScript smoke tests run on Node directly

Until STACK-012 picks the test stack, TypeScript packages test with `node --test "test/**/*.test.ts"`. Node 26 strips types itself, so `tsconfig.base.json` sets `erasableSyntaxOnly` and `allowImportingTsExtensions`, and imports name the `.ts` file. Enums, namespaces and parameter properties are not allowed under this setting.

## Biome config migrations

Biome 2.5 deprecated `"recommended": true` under `linter.rules` in favour of `"preset": "recommended"`. Run `pnpm biome migrate --write` after upgrading Biome and check that `pnpm check` prints no info diagnostics.

## astral-sh/setup-uv has no major version tag

`actions/checkout@v7` and similar resolve, but `astral-sh/setup-uv@v10` fails with "unable to find version". Astral only publishes full tags, so pin `astral-sh/setup-uv@v10.2.0` and bump it on purpose. Source: FOUND-001 CI run 37534541225.

## Project references do not work with noEmit packages

TypeScript 7 rejects a reference to a project that disables emit (`TS6310`). This repository shares source between packages instead, as decided in [ADR 0008](../adr/0008-typescript-internal-packages.md) and as the Turborepo TypeScript guide recommends.

## Cache keys only cover files inside a package

Turborepo hashes a package's own files. A tsconfig preset in a root folder changes no cache key, so a stricter preset would replay old passes. That is why the presets live in the `@parfocal/typescript-config` package that every TypeScript package depends on. For the same reason, `typecheck` and `test` depend on the `topo` transit task, which brings in the hashes of imported workspace packages, and root files that affect every package are listed in `globalDependencies`. Check new root-level config files against this before relying on the cache.

## Turborepo ships its own docs

`node_modules/turbo/docs` holds the guides for the installed version, including `guides/tools/typescript.mdx` and `guides/tools/python.mdx`. Read them before changing `turbo.json`, because they match the installed version and can differ from older articles.

## basedpyright strictness is set per package

Each Python package has its own `[tool.basedpyright]` block, strict for `apps/api` and `packages/py-common` and standard for `workers/*` ([ADR 0007](../adr/0007-python-tooling.md)). basedpyright reads the config of the folder it runs in, so the per-package `typecheck` script runs inside the package. Running `uv run basedpyright` at the root only checks `scripts/` under the root config. Tested by adding an untyped function: 5 errors in `apps/api`, none in `workers/ml`.

## The ADR check tests stay on unittest

`scripts/test_check_adrs.py` uses `unittest` so the `docs` workflow can run it with plain Python and no installs. Ruff's `PT009` is ignored for `scripts/test_*.py` only. pytest also collects these tests from the root through `pythonpath = ["scripts"]`.

## Oxlint needs the solution-style tsconfig

Oxlint's type-aware engine, like editors, picks the `tsconfig.json` nearest to a file. While that file covered only `src`, test files got no Node types and every `assert` call was reported as unsafe. Each package's `tsconfig.json` now has `"files": []` and references its `src`, test and worker configs ([ADR 0009](../adr/0009-quality-gates.md)). New packages must follow the same layout.

## node:test calls are floating promises

`test()`, `it()` and `describe()` from `node:test` return promises that are never awaited. `.oxlintrc.json` allows them through `allowForKnownSafeCalls` instead of disabling `no-floating-promises`. A planted unawaited call elsewhere is still reported.

## pnpm warns about blocked build scripts

pnpm 12 does not run dependency install scripts unless they are allowed, and prints "to run scripts" after installs. lefthook does not need its install script because the root `prepare` script runs `lefthook install`.
