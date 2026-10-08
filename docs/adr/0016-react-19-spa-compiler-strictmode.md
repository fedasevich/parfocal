# 0016. React 19 SPA with React Compiler, and StrictMode around the viewer

- Date: 2026-10-08
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-002

## Context

STACK-002 asks for the React version and rendering mode, whether React Compiler is on, and the StrictMode policy for the viewer canvas. Every screen is authenticated and canvas-heavy, and the app is served as static assets from Cloudflare ([ADR 0003](0003-pilot-platform-architecture.md)) and built with Vite 8 ([ADR 0015](0015-vite-build-tool.md)). The viewer engine lives outside React (STACK-006), so React re-renders never drive frames. POC doc 24 showed that the costliest leak came from a deck torn down without releasing its canvas context. React 19.3.0 has been out since 2026-09-09. Versions were checked on 2026-10-08.

## Options considered

1. Rendering: a React 19 SPA with `createRoot`, or React 19 with a server framework (Next.js, React Router framework mode). Server rendering helps public pages and first paint for anonymous users, and Parfocal has neither.
2. React Compiler: off, on through the Babel preset (`babel-plugin-react-compiler` 1.0, stable, about 100 ms more per build in the spike), or on through plugin-react's native compiler (same output in the spike at almost no build cost, but marked experimental).
3. StrictMode: on for the whole app including the viewer host, on everywhere except the viewer subtree, or off. StrictMode only acts in development, where it mounts, unmounts and remounts every effect.

## Decision

| Concern | Choice |
|---|---|
| React | React 19.3 and React DOM 19.3, client-rendered SPA with `createRoot`, no server rendering |
| React Compiler | On for the whole app through the Babel preset (`@rolldown/plugin-babel` with `reactCompilerPreset()`). Switch to `react({ compiler: true })` once plugin-react stops calling it experimental, after checking that the output matches |
| StrictMode | On for the whole app, the viewer host included |
| Viewer host | The engine creates its own canvas. The host's mount effect creates the engine, and its cleanup destroys it, which means finalizing the deck, destroying luma.gl's canvas context, losing the WebGL context, zeroing and removing the canvas. The host never reuses a canvas whose context was lost |

StrictMode stays on because its dev-mode remount is the cheapest leak detector there is. In the spike, a host without cleanup showed two contexts on its first dev mount, while the production build hid the leak until Chrome dropped contexts at 16 ([results/2026-10-08-react-compiler-strictmode-spike.md](../results/2026-10-08-react-compiler-strictmode-spike.md)).

## Consequences

- In development every viewer mount builds the engine twice. Opening a slide in dev costs one extra engine setup, which is acceptable and does not happen in production.
- Engine code must make `destroy()` complete and idempotent. STACK-006 and STACK-015 test it with the context counter from the spike and the 20-slide-switch memory test.
- React Compiler memoizes components automatically, so `useMemo` and `useCallback` are only for values the compiler cannot see, such as identities passed to the engine.
- TODO: Oxlint has the rules-of-hooks checks but not React Compiler's own diagnostics. STACK-012 or a quality-gate task should decide whether to surface the compiler's bail-outs in CI.
