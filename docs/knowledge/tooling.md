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
