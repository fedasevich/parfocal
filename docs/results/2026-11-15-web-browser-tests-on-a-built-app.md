# Result: web browser tests on a built app

- Date: 2026-11-15
- Backlog: FOUND-026
- Kind: benchmark
- Commit: 2d6ba073 for the dev server runs, the FOUND-026 branch for the built app runs
- Environment: Apple M4 Mac with 24 GB, macOS 15.8.1, Google Chrome 157.0.8103.51 headless, Playwright with `--workers=1`. The Mac was shared with four other agents, so absolute times carry noise
- Data: the fake API and the synthetic fixture slide, no PHI

## Question

How much of a page load and of the web suite's wall time goes away when the Playwright specs run against `vite build --mode e2e` served by `vite preview` instead of the Vite dev server.

## Method

Page load: `page-load.mjs` (a scratch script) opens `/prototype` seven times, each in a fresh browser context against an already running server, and times `goto` until the first "Full viewer" link of the screens list is visible. It counts the requests of each load. The first load against the dev server is also the first time Vite transforms the modules.

Suite: the full suite has 734 tests and would take well over 20 minutes on one worker, so a fixed subset of 20 spec files ran once each way. It is the first 17 spec files of `apps/web/e2e` in alphabetical order (`account-menu` to `auto-region`) plus `full-viewer`, `deep-links` and `viewer-tools`, 157 tests in all. Command: `npx playwright test <the 20 files> --workers=1` with `PARFOCAL_E2E_PORT=5207` and no server running, so Playwright started its own server and the wall time includes the dev server start or the e2e build and preview start. The before run used a clean worktree at commit 2d6ba073 and the after run this branch.

## Results

| Measure | Dev server | Built app |
|---|---|---|
| First page load of `/prototype` | 11,052 ms | 744 ms |
| Median of seven page loads | 1,539 ms | 1,252 ms |
| Requests per page load | 428 | 173 |
| `vite build --mode e2e` on its own | none | 105 s |
| Subset test time reported by Playwright | 26.2 min | 9.9 min |
| Subset wall time including server start | 1,578 s | 597 s |
| Subset tests passed | 156 of 157 | 157 of 157 |
| Slowest file | `full-viewer`, 5.2 min | below Playwright's slow-file report |

The one failure on the dev server was `add-result-set.spec.ts` "a GeoJSON is previewed on the slide, shifted and scaled, saved and listed in Layers", where a `toHaveAttribute` check failed. It passed on the built app.

The `flow-map.spec.ts` check "every box opens a route of the app" failed in all four parts on the built app. A probe on the dev server showed why. Many boxes open pages with no level 1 heading, and on the dev server the check passed only because the flow map's own heading was still on screen when it looked. The spec now waits for the flow map heading to go and then for any heading.

## Interpretation

The built app removes about two thirds of the requests per page and the cold transform cost of the first load, which is where CI's software graphics runner spent its 30 second budgets. On this Mac the subset ran 2.6 times faster end to end, even with the build inside the measured time. CI pays the build once per shard. The median warm page load moved less than the first load, because the dev server had already cached its transforms by then and the prototype page itself loads many lazy chunks.

## Follow-ups

- The ADR "web browser tests run against a built app" records the build mode, the flag and the guard.
- TODO measure the CI browser job's wall time per web shard after the merge, from the workflow run.
