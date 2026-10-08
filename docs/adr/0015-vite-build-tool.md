# 0015. Vite 8 as the build tool and dev server

- Date: 2026-10-08
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: STACK-001

## Context

The web app is a client-heavy SPA with module workers, WebAssembly (onnxruntime-web, image codecs) and WebGPU, and it must be cross-origin isolated so WebAssembly can use threads (POC doc 14). [ADR 0003](0003-pilot-platform-architecture.md) serves it from Cloudflare, and FOUND-009 plans to run the edge Worker and Durable Objects inside the dev server through the Cloudflare Vite plugin. STACK-012's default test runner is Vitest. Versions were checked on 2026-10-08.

## Options considered

1. Vite 8.3 (Rolldown-based). The POC already runs on Vite 8. The Cloudflare Vite plugin 1.63 supports Vite 6 to 8, and Vitest shares its config and transforms. Module workers with `new URL(..., import.meta.url)` and `?url` asset imports work without extra config. Its production build relies on Rolldown, which is newer than Rollup.
2. Rsbuild 2.2 (Rspack). It builds fast and handles workers and WebAssembly, but it has no equivalent of the Cloudflare Vite plugin, so the Worker and Durable Objects would run in a separate process in development. Using Vitest would mean keeping a second config.
3. Next.js in SPA mode (static export). Every Parfocal screen is authenticated and canvas-heavy, so server rendering adds little. Static export drops most of what Next.js offers, and workers and WebAssembly go through its own bundler config.

## Decision

Vite 8, with `worker.format: "es"`. COOP `same-origin` and COEP `credentialless` are set through plain `server.headers` and `preview.headers`, because the spike showed that Vite 8 applies them to transformed modules and workers, which the POC's middleware worked around. Any worker that uses onnxruntime-web sets `env.wasm.wasmPaths` from `?url` imports of its `.mjs` and `.wasm` files. Evidence is in [results/2026-10-08-vite-worker-wasm-spike.md](../results/2026-10-08-vite-worker-wasm-spike.md).

## Consequences

- FOUND-009 can run the edge Worker and Durable Objects under `vite dev` with the Cloudflare plugin, and STACK-012 can use Vitest on the same config.
- The headers keep WebAssembly multi-threaded only where Vite serves the app. Production gets them from the edge, which SKEL-001 checks.
- The onnxruntime-web rule belongs in the code that loads models (AINUC and the segmentation tool), and [knowledge/viewer-build.md](../knowledge/viewer-build.md) records it so nobody rediscovers the hang.
- The onnxruntime-web WebAssembly binary is 26.8 MB and should be cached and loaded only when a model is first used.
