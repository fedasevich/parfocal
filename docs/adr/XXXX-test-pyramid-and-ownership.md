# XXXX. The test pyramid has six levels, each owned by one place and one CI job

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: TEST-000 (testing research check). Confirms STACK-012 (frontend testing stack) and sets the owner of each level for the remaining TEST tasks.

## Context

TEST-000 asks for two things: confirm STACK-012 and write the test pyramid with an owner per level. STACK-012 was decided in [ADR 0146](0146-frontend-testing-stack.md) (frontend tests stay on node:test and Playwright, Storybook for components, MSW for the API, SwiftShader for WebGL and WebGPU frames). Most of the pyramid was built task by task since then, so this ADR records it as it stands on 2026-11-09 and does not invent a new one.

Counts below are test files tracked in git, measured on 2026-11-09 with `git ls-files`. They count files, not test cases.

| Place | Unit or API files | Browser spec files |
|---|---|---|
| `apps/web` | 196 `*.test.ts(x)` | 146 `*.spec.ts` in `e2e/` |
| `apps/api` | 138 Python | none |
| `apps/edge` | 10 | none |
| `apps/e2e` | none | 6 `*.spec.ts` in `tests/` |
| `packages/viewer-engine` | 83 | 26 |
| `packages/ui` | 33 | 48 |
| `packages/api-client` | 30 | none |
| `packages/py-common` | 25 Python | none |
| `workers/ml` | 18 Python | none |
| `workers/ingest` | 17 Python | none |
| `packages/golden-images` | 4 | 14, with 62 golden files |
| `scripts` | 9 | none |
| `packages/latency-proxy` | 1 | 1 |

There are also 60 Storybook story files, which the `packages/ui` browser specs drive.

## Confirming STACK-012

The decision stands with no change. Each part is checked against what exists:

- `node --test` is the unit runner in every TypeScript package and in `scripts`. Nothing has needed a simulated DOM, so Vitest is still not added.
- Components are tested as Storybook stories in real Chrome, driven by Playwright with axe, in `packages/ui`.
- MSW serves the fake API in the app, in Storybook and in the web E2E.
- WebGL and WebGPU frames run on SwiftShader in hosted Linux CI, and the golden images pass there ([ADR 0101](0101-golden-image-comparison.md), golden images compared per channel on SwiftShader frames). The `browser` job in `.github/workflows/ci.yml` runs `golden-images` as its own matrix entry.
- The one gap ADR 0146 listed stays open and is owned by TEST-008 (visual regression for UI): `toHaveScreenshot` on UI chrome is not wired yet.

## Decision

The pyramid has six levels. Each has one owning place for its tests and one CI job that fails the build. A test belongs at the lowest level that can see the bug.

| Level | What it proves | Tool | Owning place | CI job |
|---|---|---|---|---|
| 1. Unit | Logic, models, stores, pure functions, config guards | `node --test`, `pytest` | next to the code in each package, repository guards in `scripts` | `test` |
| 2. API and database | Routes, permissions, tenant isolation, migrations, row-level rules | `pytest` with the `db` marker against compose Postgres | `apps/api/tests` | `db` |
| 3. Contract and worker | Generated API client matches the schema, ingest reads every fixture format, ML export contracts | `pytest` and `node --test` on fixture slides | `packages/api-client`, `workers/ingest`, `workers/ml` | `test`, `formats`, `camelyon` |
| 4. Component | Stories render, are accessible and respond, in real Chrome | Storybook, Playwright, axe, MSW | `packages/ui` | `browser (ui)` |
| 5. Rendering and performance | Pixels on SwiftShader, tile and memory budgets, request latency | Playwright, per-channel goldens, `perf-budgets.json` | `packages/golden-images`, `packages/viewer-engine`, `packages/latency-proxy` | one `browser` entry per package |
| 6. End to end | Whole flows through the app, on the fake API and on the real stack | Playwright | `apps/web/e2e` on the fake API, `apps/e2e` on the real stack | `browser (web 1/3, 2/3, 3/3)` and `e2e` |

Rules that follow:

- The `browser` job runs one matrix entry per package. The web E2E is split into three shards because it is the largest suite (146 spec files). A new browser package adds one matrix entry and nothing else.
- The golden images in `packages/golden-images` are the only owner of pixel truth for slide frames. Other packages assert behaviour, not pixels, so a rendering change updates goldens in one place.
- Performance budgets live in the single root `perf-budgets.json` ([ADR 0154](0154-performance-budget-file-and-regression-rule.md), one budget file with a 20 percent rule for byte and count budgets). The suite is level 5 and is owned by `packages/viewer-engine` and `packages/latency-proxy`.
- Tenant isolation is a level 2 concern. TEST-003 (tenant isolation test generator) is done and its generated cases live with the API tests, so no web test is asked to prove isolation.
- Real-GPU frame rates and GPU timing stay manual on the owner's Mac, because hosted runners only are used ([ADR 0011](0011-hosted-ci-only.md), hosted CI runners only). TEST-018 (self-hosted Mac GPU runner) is dropped for that reason.
- Flaky tests are reported by `scripts/flaky.ts` from the Playwright JSON report of every browser and E2E job. TEST-017 (flaky test management) is in review and adds the quarantine with an issue link and an expiry date.

## What the remaining TEST tasks add

Done: API test harness (TEST-002), tenant isolation generator (TEST-003), golden-image rendering tests (TEST-005), performance budget suite (TEST-006), API client contract tests (TEST-011), fixture slide library in CI (TEST-012), workflow and job tests (TEST-013) and test data hygiene (TEST-016).

Still to build, each placed on the pyramid:

- Unit test setup with coverage gates per package (TEST-001) adds a coverage report and a minimum to level 1 and level 2.
- E2E harness (TEST-004) hardens level 6 with auth helpers, traces and video on failure, and cleanup of the workspace and project each run creates.
- Memory and leak suite (TEST-007) adds a nightly level 5 run of 20 slides with heap snapshots on software rendering.
- Visual regression for UI (TEST-008) adds `toHaveScreenshot` on stories in both themes and densities to level 4, which makes a visual diff block a pull request until approved.
- Accessibility testing (TEST-009) extends axe from stories to every E2E page and adds keyboard-only flows, so an accessibility violation fails CI at levels 4 and 6.
- Load test tooling (TEST-010) is a level 7 outside the pull request path: k6 or Locust scenarios run on demand against staging, never against production.
- Security tests in CI (TEST-014) adds dependency and container scans to the pull request path and a DAST baseline scan on preview environments.
- Cross-browser matrix (TEST-015) adds a nightly Firefox and WebKit run of the viewer on WebGL2, with WebGPU only on Chromium. It reuses the level 5 specs and adds no new tests.
- Showcase seed over every feature (TEST-020) adds a coverage test at level 2 that fails when any task state, decision kind, role or format has no seeded row, plus one staging E2E at level 6.

## Consequences

- No new dependency, runner or CI job is added by this ADR. The pyramid is a rule for where a new test goes, and the table above is the place to check first.
- A task whose "Done when" line names a test names the level from the table, so reviewers can see which job must go green.
- Counts above are file counts and will drift. They are a snapshot for this decision and are not a gate. TEST-001 produces the per-package coverage numbers that replace them.
- ADR 0146 stays Accepted as the frontend part. This ADR adds the backend, worker and ownership view around it.
