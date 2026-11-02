# 0146. Frontend tests stay on node:test and Playwright, with Storybook for components, MSW for the API and SwiftShader for WebGL and WebGPU frames

- Date: 2026-11-02
- Status: Proposed
- Deciders: Yurii Fedas (to confirm)
- Backlog: STACK-012 (frontend testing stack). Touches TEST-005 (golden-image rendering tests), TEST-008 (visual regression for UI) and every VIEW task whose "Done when" names a golden image or a WebGPU route.

## Context

The backlog's default for STACK-012 was Vitest with React Testing Library, MSW, Playwright for E2E and visual tests, and Storybook as the component catalogue. By 2026-11-02 most of the stack already existed, built task by task:

- TypeScript units in every package run on `node --test` with Node 26 type stripping. `apps/web` has 21 such files, all testing models, routes and config without a DOM.
- Playwright 1.64 runs the web E2E against the fake API (`apps/web/e2e`), browser suites in `packages/viewer-engine`, and golden images in `packages/golden-images` under SwiftShader ([ADR 0101](0101-golden-image-comparison.md), golden images compared per channel on SwiftShader frames).
- Storybook 10.6 is the component catalogue in `packages/ui`, with `msw-storybook-addon`, and its built stories are tested by Playwright with axe.
- MSW 3 serves the fake API in the app and in Storybook.

What was missing: a choice of unit runner, a rule for UI screenshots, and any proof that WebGPU tests can run on hosted runners ([ADR 0011](0011-hosted-ci-only.md), hosted CI runners only). The spike numbers are in [results/2026-11-02-frontend-testing-stack-spike.md](../results/2026-11-02-frontend-testing-stack-spike.md).

## Options considered

Unit runner:

1. Keep `node:test`. No new dependency, already the `test` script of 10 TypeScript packages and wired into Turborepo and Oxlint. No jsdom, no module mocking helpers beyond `mock`, and no watch UI worth the name.
2. Vitest 4 with React Testing Library and jsdom or happy-dom. The common choice for Vite apps, with fast watch, snapshot helpers and component rendering in a simulated DOM. It is a second runner beside Playwright, every package's `test` script and Oxlint's `node:test` exception would change, and a simulated DOM cannot test canvases, layout or focus as a real browser does.
3. Vitest browser mode with Playwright as provider. Real Chrome for components, but it duplicates what Storybook plus Playwright already does here.

Component tests:

1. Storybook stories rendered in real Chrome and driven by Playwright, with axe. Exists, and the stories are the catalogue the owner reviews.
2. React Testing Library in a simulated DOM. Faster per test, but blind to the CSS, layout and canvas this product depends on.

WebGPU in CI:

1. SwiftShader's WebGPU adapter in headless Chrome, with `--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader`. Free, same backend as the WebGL goldens.
2. No WebGPU in CI, only manual runs on the owner's Mac. Then a WebGPU renderer could break unseen.

## Decision

Unit option 1, component option 1 and WebGPU option 1.

| Kind of test | Tool | Where it runs |
|---|---|---|
| Logic, models, stores, pure functions | `node --test` | every package's `test`, hosted Linux on every push |
| Components | Storybook 10 stories driven by Playwright, with axe | `packages/ui` `test:browser` |
| API mocks | MSW 3, one set of handlers for the app, Storybook and E2E | everywhere |
| E2E | Playwright against the app on the fake API, and against the real stack in the `e2e` job | hosted Linux |
| WebGL frames | per-channel goldens on SwiftShader (ADR 0101) | `browser` job |
| WebGPU frames | the same goldens and the element screenshot path, with the two WebGPU flags on a secure origin | `browser` job |
| UI chrome screenshots | Playwright `toHaveScreenshot` against Storybook, proposed for TEST-008 | not yet |

- `node:test` stays because no current test needs a DOM, and a component test that does belongs in a real browser through a story. This reverses if a package grows logic that needs jsdom-level DOM tests that a story cannot express, or if watch mode becomes a real cost. Then Vitest is added to that package only.
- WebGPU joins the golden harness because SwiftShader's WebGPU adapter drew the synthetic tile with zero difference from the WebGL golden on the M4. A WebGPU spec must assert the adapter architecture is `swiftshader` and fail otherwise, as WebGL specs assert the renderer string.
- Viv tiles on SwiftShader in CI were already proven by the CMU-1.svs goldens, which were written on the M4 and pass on the hosted x86 runner.

## Consequences

- No new dependency. [knowledge/tooling.md](../knowledge/tooling.md) no longer calls `node:test` provisional.
- WebGPU tests use `test.use({ launchOptions: { args: [...] } })` with the two extra flags and open a page on `https` or `localhost`, because `navigator.gpu` does not exist on `about:blank`.
- TODO: the hosted Linux numbers for the WebGPU spec come from the first completed `browser` run after commit dd81b8c and go into the result file.
- Real-GPU frame rates and GPU timing stay manual on the owner's Mac, as ADR 0011 says.
