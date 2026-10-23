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

## pnpm 12 fails CI on unapproved build scripts

Locally pnpm only warns about ignored dependency build scripts, but in CI it stops with `ERR_PNPM_IGNORED_BUILDS`. Every dependency with an install script needs an explicit decision in `allowBuilds` in `pnpm-workspace.yaml`, made with `pnpm approve-builds <pkg>` or `pnpm approve-builds '!<pkg>'`. lefthook is denied because the root `prepare` script installs the hooks. esbuild, which Orval pulls in, is denied because its script only checks the binary that its platform package already ships. Check new dev tools with `CI=true pnpm install --frozen-lockfile` in a fresh clone before pushing. Source: FOUND-006 CI run 37536244555 and FOUND-008 CI run 37747805617.

## pnpm 12 holds back brand-new releases

pnpm 12 applies a minimum release age before it installs a version, as a supply-chain safeguard. Pinning a version published the same day adds an entry to `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`, as happened with `@cloudflare/workers-types@5.20261006.1`. Review these entries and remove them once the version is old enough.

## CI jobs and the main ruleset

The `ci` workflow has `lint`, `typecheck` and `test` jobs that share `.github/actions/setup-workspace`, and a `ci-ok` job that fails when any of them fails, is cancelled or is skipped. The repository ruleset "main requires ci-ok" (id 24612221) requires only `ci-ok`, so new jobs are added under `ci-ok`'s `needs` and the ruleset never has to change. Repository admins can bypass the ruleset, which is how direct pushes to `main` keep working. Actions also require approval before workflows run for any outside contributor. Proven on 2026-10-06 by pull request #2, which broke one unit test: `test` and `ci-ok` failed and GitHub reported the merge as blocked.

## Commit messages and releases

lefthook's `commit-msg` hook runs commitlint, so a message without a Conventional Commits type fails before the commit exists. `commitlint.config.js` turns off the case and line-length rules so backlog IDs stay upper case and subjects stay in sentence case ([ADR 0014](../adr/0014-conventional-commits-and-releases.md)). After cloning, `pnpm install` installs the hook through the `prepare` script. A checkout made before FOUND-017 needs `pnpm lefthook install` once to add `commit-msg`. git-cliff reads `cliff.toml` and only counts tags shaped like `vX.Y.Z`. Check `pnpm exec git-cliff --bumped-version` before a release, because it reports the latest tag unchanged when no commit since then is conventional.

## Generators built on the TypeScript compiler API break on TypeScript 7

TypeScript 7 is the native Go compiler and its package does not expose the JavaScript compiler API. Tools that build code through it, such as Hey API openapi-ts 0.99, crash with `Cannot read properties of undefined (reading 'AnyKeyword')` when TypeScript 7 is installed. Check a new code generator against `typescript@7` before adopting it. Source: [codegen spike](../results/2026-10-08-api-client-codegen-spike.md).

## Starlette's test client wants httpx2

FastAPI 0.142's `TestClient` warns that using `httpx` is deprecated and asks for `httpx2`, the pydantic team's successor. The root dev group installs `httpx2`. Source: FOUND-010 log entry.

## pydantic's PostgresDsn is a multi-host URL

`PostgresDsn` parses into `MultiHostUrl`, which has `hosts()` instead of `host`. Read the host as `settings.database_url.hosts()[0]["host"]`.

## An ADR status line holds only the status

`scripts/check_adrs.py` accepts exactly `Proposed`, `Accepted`, `Rejected` or `Superseded by NNNN`. A note such as "Accepted, its Pages part amended by ADR 0050" turned the docs workflow red on `main`. Put partial changes on their own line, such as `- Amended by: [ADR 0050](0050-deploy-pipeline-and-previews.md), which replaces its Pages part`. See the FOUND-020 (task board) entry of 2026-10-15 in the [log](../log.md).

## Biome lints HTML files too

`biome check .` reads `.html` files, inline scripts and styles included, so a page such as `scripts/board.html` needs `type` on every button and no control characters in regular expressions.

## Calling a settings class without arguments fails basedpyright

pydantic-settings fills required fields from the environment, but basedpyright reports the missing constructor arguments. `load_settings(SettingsClass)` in `parfocal_common.settings` makes that call in one typed place, so no ignore comments are needed.

## Run the repository typecheck, not one package's

`pnpm turbo run typecheck` runs basedpyright in every Python package (`apps/api`, `packages/py-common`, `workers/ingest`, `workers/ml`) and `tsc` in the TypeScript ones, as the CI `typecheck` job does. Running basedpyright only in the package you edited misses a test added to another package. A `Mapping[object, str]` parameter, for example, rejects a `dict[str, str]` argument because mapping keys are invariant, and only the `py-common` check saw it. Use a type parameter (`def f[K](values: Mapping[K, str])`) instead.

## `pnpm check` also checks files you have not staged

Biome and ruff in `pnpm check` read the working tree, so an untracked file of the next task can fail the check of the one being committed, as an unformatted JSON fixture did. Biome formats JSON too: run `pnpm exec biome format --write <file>` on new JSON fixtures, while `.geojson` files are not checked. Before trusting a red check, look at which file it names.

## Chrome on a Mac can render WebGL on SwiftShader

The golden suite launches Chrome with `--use-angle=swiftshader --enable-unsafe-swiftshader`, and on an Apple M4 WebGL2 then reports `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...))` instead of Metal. Goldens can therefore be written on the owner's Mac with the same backend hosted Linux uses. Without the flags, Metal differs from SwiftShader by up to 1 level on linear-filtered views. `assertSwiftShader(page)` in `@parfocal/golden-images` fails a run on any other backend. Source: [golden-image result](../results/2026-10-23-golden-image-tolerances.md).

## Playwright test passes config launch options to every launch

Inside a Playwright test, `chromium.launch()` picks up `use.launchOptions` from the config, so a second browser meant to use the hardware GPU still came up on SwiftShader. Pass `args: []` explicitly to get a plain browser. Source: TEST-005 measurement spec.

## Browser suites skip the Turborepo cache

`test:browser` sets `"cache": false` in `turbo.json`. The cache key does not include the installed Chrome version, so a cached pass would hide a Chrome update that changes the goldens or the timings. The root script also runs it with `--concurrency=1` so the latency measurements do not share the CPU with the golden suite.

## Timer pacing drifts unless it keeps a schedule

The latency proxy paces bandwidth in 16 KiB slices with `setTimeout`. Starting each slice from "now" let Node's timer lateness add up, and 1 MB at 20 MB/s took 70 ms instead of 50. The link now keeps its own schedule while any response is streaming and starts afresh when none is or after 5 ms of idle time, which measured 52.1 ms.

## Timing tests check the fastest sample

Under `pnpm test`, Turborepo runs the Python suites next to the Node ones, and the latency tests saw a median 64 ms added at a 50 ms RTT. Load only adds time, so the tests assert on the fastest of several samples: it must be at least the RTT and within `max(10 ms, 10%)` above it. Use the same rule for any CPU-side timing test that shares a runner. Source: [latency proxy result](../results/2026-10-23-latency-proxy.md).
