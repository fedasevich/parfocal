# 0008. TypeScript packages share source instead of project references

- Date: 2026-10-06
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: FOUND-004. Touches every TypeScript package and `turbo.json`.

## Context

FOUND-004 asked for strict mode, TypeScript project references across packages, path aliases and separate configs for workers. The packages export their `.ts` source, Node 26 runs that source directly by stripping types, and every package typechecks with `tsc --noEmit` ([ADR 0006](0006-monorepo-tooling.md)).

A check with TypeScript 7.0.2 showed that a project reference fails with `TS6310: Referenced project ... may not disable emit`. Project references need every referenced package to emit declaration files. The owner asked for the current state of the art. The TypeScript guide bundled with Turborepo 2.11.7 (`node_modules/turbo/docs/guides/tools/typescript.mdx`) recommends Just-in-Time packages that export source, Node subpath imports instead of `paths`, a shared config package, and a `topo` transit node for type checks. It says "We don't recommend using TypeScript Project References".

## Options considered

1. Project references with `composite` and `emitDeclarationOnly`. Each package builds `.d.ts` files, and `tsc -b` checks the graph incrementally. Needs a build step before every typecheck and output folders, adds a second cache layer next to Turborepo's, and `allowImportingTsExtensions` no longer fits.
2. Just-in-Time internal packages, as Turborepo recommends. Packages depend on each other through `workspace:*`, `exports` point at `src/index.ts`, each package's `tsc --noEmit` checks the source it imports, and go-to-definition lands in source. No build step. Each package rechecks the code it imports, which costs little with TypeScript 7.
3. Turborepo's native uv workspace support for the Python side. Rejected for now because the bundled guide marks it experimental and not for environments where stability matters. Revisit when it is stable.

## Decision

Option 2.

| Concern | Choice |
|---|---|
| Shared config | Package `packages/typescript-config` (`@parfocal/typescript-config`), a `workspace:*` dev dependency of every TypeScript package, so config edits change their cache keys |
| Strictness | `base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly` and `moduleDetection: force` |
| Environments | Presets `browser.json`, `webworker.json`, `node.json` and `cloudflare.json` |
| Per package | `tsconfig.json` for `src` in its environment, `tsconfig.test.json` for tests under Node. `packages/viewer-engine` adds `tsconfig.worker.json` for `src/workers` with the web worker library |
| Aliases across packages | Package names such as `@parfocal/tokens`, declared as `workspace:*` dependencies |
| Aliases inside a package | Node subpath imports, `"imports": { "#*": "./src/*" }`, used as `#file.ts` |
| Task graph | A `topo` transit task (`dependsOn: ["^topo"]`). `typecheck` and `test` depend on `topo`, so they run in parallel while their cache keys still change when a dependency's source changes |
| Root inputs | `globalDependencies` holds `.node-version`, `.python-version`, `pyproject.toml` and `uv.lock`, which affect every task |
| Guard | `scripts/typecheck-guard.test.ts` proves a missing export and an undeclared workspace package both fail the typecheck. CI runs it |

Measured on 2026-10-06: an edit to `typescript-config/base.json` reran all 14 TypeScript tasks and kept the 8 Python tasks cached. An edit to `@parfocal/tokens` reran only `tokens`, `ui` and `web`. An edit to the root `pyproject.toml` reran all 22 tasks.

## Consequences

- A package can only import workspace packages it declares, because pnpm does not hoist them. The guard test covers this.
- Code under `packages/viewer-engine/src/workers` is typed against the web worker library, not the DOM. The edge app is typed against Cloudflare's runtime types.
- If typecheck time grows too large, revisit project references with declaration output through a new ADR.
