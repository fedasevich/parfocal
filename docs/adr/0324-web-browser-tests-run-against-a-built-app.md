# 0324. Web browser tests run against a built app

- Date: 2026-11-15
- Status: Accepted
- Deciders: agent (FOUND-026), owner by review
- Backlog: FOUND-026

## Context

The `apps/web` Playwright suite ran on the Vite dev server. One fresh page there fetches about 430 unbundled modules, and on CI's software graphics many specs ran out of their 30 second budget during full page loads. The fake API, the developer pages (prototype index, flow map, issue pages, issue states and the spikes), the "view as" menu and the pseudo locale all started only under `import.meta.env.DEV`, which is false in every build, so a build could not serve the suite. The production build must still never carry the fake API or a developer page, which is what [ADR 0135](0135-fake-data-through-the-api-client-with-msw.md) (fake data through the API client with MSW) and the existing bundle guard rely on. [ADR 0146](0146-frontend-testing-stack.md) (the frontend testing stack) chose Playwright for these specs.

## Options considered

1. Keep the dev server and raise timeouts or pre-warm the module graph. Cheap, but every fresh page still pays for hundreds of requests and the suite stays slow and flaky on CI.
2. Override `import.meta.env.DEV` to true in a test build. No source edits, but it lies about a built-in value that libraries and readers trust, and it gives the production guard nothing explicit to check.
3. A build mode `e2e` with its own public flag, `PARFOCAL_PUBLIC_DEV_TOOLS`, that turns on the fake API and the developer pages, served with `vite preview`. The production build leaves the developer route files out of its route tree, and a guard test checks the output.

## Decision

Option 3. `vite/dev-tools.ts` resolves the flag. It is on for the dev server unless set to `off`, on for a build or preview only when set to `on`, and a staging or prod build refuses it. Vite's `define` writes the resolved value, so every check in the app reads `import.meta.env.PARFOCAL_PUBLIC_DEV_TOOLS === "on"` and folds to a constant, which lets the bundler drop the fake API imports. A build without the flag points the TanStack router generator at a second route tree under `node_modules/.parfocal` that ignores the developer route files, so those pages are not merely guarded but absent. The committed `src/routeTree.gen.ts` is left alone.

The Playwright config builds with `vite build --mode e2e` into `dist-e2e` and serves it with `vite preview --mode e2e`. The fixture tiles and mock assets middlewares, and the fake API service worker file, follow the flag into preview. `PARFOCAL_E2E_SERVER=dev` keeps the dev server for local work on a single spec. CI's browser job runs the web shards through that Playwright config, so the workflow itself needs no change.

`test/bundle.test.ts` is the guard. It builds for dev, staging and prod without the flag and fails if any output names the fake API or a developer route path, builds the test build as a positive control that holds them all, and checks that staging and prod refuse the flag. The numbers before and after are in [the result file](../results/2026-11-15-web-browser-tests-on-a-built-app.md).

## Consequences

Each web shard on CI builds the app once before its tests, which costs build time but removes the per-page module cost. A change to app code now needs a rebuild before a local run sees it, unless the developer sets `PARFOCAL_E2E_SERVER=dev`. New developer pages must be added to `developerRouteFiles` and `developerRoutePaths` in `vite/dev-tools.ts`, and new dev-only code checks the flag instead of `import.meta.env.DEV`.
