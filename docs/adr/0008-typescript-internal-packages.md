# 0008. TypeScript packages share source instead of project references

- Date: 2026-10-06
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: FOUND-004. Touches every TypeScript package.

## Context

FOUND-004 asked for strict mode, TypeScript project references across packages, path aliases and separate configs for workers. The packages export their `.ts` source, Node 26 runs that source directly by stripping types, and every package typechecks with `tsc --noEmit` ([ADR 0006](0006-monorepo-tooling.md)).

A check with TypeScript 7.0.2 showed that a project reference fails with `TS6310: Referenced project ... may not disable emit`. Project references need every referenced package to emit declaration files.

## Options considered

1. Project references with `composite` and `emitDeclarationOnly`. Each package builds `.d.ts` files into an output folder, and `tsc -b` checks the graph incrementally. Needs a build step before every typecheck, output folders to ignore, and `allowImportingTsExtensions` no longer fits.
2. Internal source packages. Packages depend on each other through `workspace:*`, `exports` point at `src/index.ts`, and each package's `tsc --noEmit` checks the source it imports. Turborepo's `dependsOn: ["^typecheck"]` puts each dependency's hash into the dependent task's cache key. No build step and no output folders. Each package rechecks the code it imports, which costs little with TypeScript 7.

## Decision

Option 2.

| Concern | Choice |
|---|---|
| Strictness | `tsconfig/base.json` with `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax` and `erasableSyntaxOnly` |
| Environments | Presets `tsconfig/browser.json`, `webworker.json`, `node.json` and `cloudflare.json` |
| Per package | `tsconfig.json` for `src` in its environment, `tsconfig.test.json` for tests under Node. `packages/viewer-engine` adds `tsconfig.worker.json` for `src/workers` with the web worker library |
| Aliases across packages | Package names such as `@parfocal/tokens`, declared as `workspace:*` dependencies |
| Aliases inside a package | Node subpath imports, `"imports": { "#*": "./src/*" }`, used as `#file.ts` |
| Cache correctness | `typecheck` and `test` depend on `^typecheck` in `turbo.json` |
| Guard | `scripts/typecheck-guard.test.ts` proves a missing export and an undeclared workspace package both fail the typecheck. CI runs it |

## Consequences

- A package can only import workspace packages it declares, because pnpm does not hoist them. The guard test covers this.
- Code under `packages/viewer-engine/src/workers` is typed against the web worker library, not the DOM. The edge app is typed against Cloudflare's runtime types.
- If typecheck time grows too large, revisit project references with declaration output through a new ADR.
