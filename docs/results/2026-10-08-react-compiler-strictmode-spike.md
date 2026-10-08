# Result: React Compiler on Vite 8 and a WebGL host under StrictMode

- Date: 2026-10-08
- Backlog: STACK-002
- Kind: spike
- Commit: d80d7a9 (the spike lived in a scratch folder outside the repository and is described below)
- Environment: MacBook with Apple M4 (10 cores), macOS 15.8.1, Node 26.9.0, pnpm 12.9.1, Google Chrome 154.0.8037.98 driven headless by playwright-core 1.64.0
- Data: none

## Question

Does React Compiler work with Vite 8 and `@vitejs/plugin-react` 6 through both of its routes, and at what build cost? What does StrictMode do to a component that owns a WebGL canvas, given that POC doc 24 traced its largest leak to a deck that was finalized without releasing its canvas context?

## Method

A Vite 8.3.3 app with React 19.3.0 and React DOM 19.3.0 under `<StrictMode>`. `vite.config.ts` picks the compiler from `COMPILER`: `off` uses `react()`, `babel` adds `@rolldown/plugin-babel` 0.2.4 with `reactCompilerPreset()` from plugin-react 6.1.2, Babel 8.0.7 and `babel-plugin-react-compiler` 1.0.0, and `native` uses `react({ compiler: true })` with `oxc-transform-react` 0.152.0. Each mode was built three times without minification.

The app has a `ViewerHost` component whose mount effect calls `createEngine(container)`. That function appends a new 256 × 256 canvas, takes a WebGL2 context and draws on every animation frame. Its `destroy()` cancels the frame, calls `WEBGL_lose_context.loseContext()`, zeroes the canvas and removes it. The clean host returns `destroy` as the effect cleanup, and the leaky host returns nothing. A script wraps `getContext` to count created contexts and listens for `webglcontextlost`. Playwright loaded each host, read the counts, toggled the viewer off and on 20 times and read them again, in the dev server and in a production build.

## Results

Builds, three runs each:

| Compiler | Build times | Bundle bytes | Memo caches in output |
|---|---|---|---|
| off | 51, 46, 51 ms | 568,899 | 0 |
| Babel preset | 175, 146, 145 ms | 571,046 | 10 lines with `compiler-runtime` or `$[0]` |
| native (experimental) | 57, 47, 47 ms | 571,046 | 10 lines, byte-identical to the Babel output |

WebGL contexts (created, lost, canvases in the document):

| Server | Host | After the first mount | After 20 remounts |
|---|---|---|---|
| dev, compiler off | clean | 2, 1, 1 | 42, 41, 1 |
| dev, compiler off | leaky | 2, 0, 2 | 42, 26, 2 |
| dev, native compiler | clean | 2, 1, 1 | 42, 41, 1 |
| dev, native compiler | leaky | 2, 0, 2 | 42, 26, 2 |
| production, native compiler | clean | 1, 0, 1 | 21, 20, 1 |
| production, native compiler | leaky | 1, 0, 1 | 21, 5, 1 |

## Interpretation

- Both compiler routes work on Vite 8. On this app the native route produced the same bytes as the Babel route at a third of the build time. The plugin's README still calls the native route experimental.
- With a clean host, exactly one WebGL context is alive after StrictMode's double mount and after 20 remounts.
- Without cleanup, StrictMode in dev shows the leak on the first mount as a second context and a second canvas. In production the first mount looks fine and the leak only surfaces when Chrome forcibly loses old contexts, which it did once 16 were alive (42 − 26 and 21 − 5).
- Assumption: a deck.gl and luma.gl engine behaves like this plain WebGL2 engine as long as its `destroy()` also destroys the canvas context as doc 24 describes. STACK-015 checks that with Viv.

## Follow-ups

- [ADR 0016](../adr/0016-react-19-spa-compiler-strictmode.md) records the decision.
- TODO: STACK-006 and STACK-015 should reuse the context counter in the 20-slide-switch memory test.
