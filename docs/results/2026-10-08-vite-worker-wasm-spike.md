# Result: Vite 8 bundles an onnxruntime-web module worker under COOP and COEP

- Date: 2026-10-08
- Backlog: STACK-001
- Kind: spike
- Commit: b54882c (the spike lived in a scratch folder outside the repository and is reproduced below)
- Environment: MacBook with Apple M4 (10 cores), macOS 15.8.1, Node 26.9.0, pnpm 12.9.1, Google Chrome 154.0.8037.98 driven headless by playwright-core 1.64.0 with `--enable-unsafe-webgpu`. WebGPU reported the adapter `apple metal-3`. Localhost, no network shaping
- Data: `slimsam.encoder.onnx` from the POC's `public/models` (8,882,165 bytes), symlinked rather than copied, with a zero-filled 1 × 3 × 1024 × 1024 float32 input

## Question

Does Vite bundle a module worker that loads an ONNX model with onnxruntime-web, with the page and the worker cross-origin isolated so WebAssembly runs multi-threaded, in both the dev server and a production build? POC doc 14 found that without isolation onnxruntime-web ran on one thread, and that Vite's `server.headers` did not reach transformed modules, so a worker silently failed to start.

## Method

A folder with `vite@8.3.3`, `onnxruntime-web@1.30.0` and `playwright-core@1.64.0`, and these files:

- `vite.config.ts` sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`, first through a middleware plugin as in the POC and then through plain `server.headers` and `preview.headers`. It also sets `worker.format: "es"` and `optimizeDeps.exclude: ["onnxruntime-web"]`.
- `src/main.ts` starts `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` and posts the provider name.
- `src/worker.ts` imports `onnxruntime-web/webgpu`, sets `env.wasm.numThreads` to `navigator.hardwareConcurrency`, fetches the model, creates a session with one execution provider, runs it four times and reports the session time, the first run and the median of the last three.
- A Playwright script opens `/?provider=wasm` and `/?provider=webgpu` and reads the report.

The worker sets the paths to onnxruntime-web's glue and binary explicitly:

```ts
import * as ort from "onnxruntime-web/webgpu";
import mjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

ort.env.wasm.wasmPaths = { mjs, wasm };
```

Production runs used `vite build` then `vite preview`. Dev runs used `vite`. The production build ran three times and the dev server twice.

## Results

Build output and timings:

| Measure | Value |
|---|---|
| `vite build` (warm, three runs) | 250 to 265 ms reported, 0.35 s wall |
| Dev server ready | 81 ms reported, 204 ms until the first HTTP response |
| Page chunk | 1,196 bytes |
| Worker chunk | 116,894 bytes |
| `ort-wasm-simd-threaded.asyncify.mjs` | 53,057 bytes, emitted as its own asset |
| `ort-wasm-simd-threaded.asyncify.wasm` | 26,781,914 bytes |

Inference in the worker, in milliseconds:

| Server | Provider | Run | Threads | Session create | First run | Steady median |
|---|---|---|---|---|---|---|
| preview | wasm | 1 | 10 | 553 | 1,583 | 1,122 |
| preview | wasm | 2 | 10 | 542 | 1,641 | 1,114 |
| preview | wasm | 3 | 10 | 568 | 1,637 | 1,172 |
| preview | webgpu | 1 | 10 | 390 | 2,232 | 1,443 |
| preview | webgpu | 2 | 10 | 410 | 1,903 | 1,467 |
| preview | webgpu | 3 | 10 | 430 | 2,004 | 1,501 |
| dev | wasm | 1 | 10 | 632 | 1,733 | 1,197 |
| dev | wasm | 2 | 10 | 652 | 1,777 | 1,146 |
| dev | webgpu | 1 | 10 | 465 | 2,097 | 1,447 |
| dev | webgpu | 2 | 10 | 473 | 2,130 | 1,474 |

In every run `crossOriginIsolated` was true in the page and in the worker, and `SharedArrayBuffer` existed in the worker.

Header checks on the dev server with plain `server.headers` and no plugin:

| Response | COEP header present |
|---|---|
| `/` | yes |
| `/src/main.ts` | yes |
| `/src/worker.ts?worker_file&type=module` | yes |
| `/models/slimsam.encoder.onnx` | yes |

With `server.headers` only, both providers ran with 10 threads (steady medians 1,145 ms for wasm and 1,460 ms for webgpu).

The first attempt, without `wasmPaths`, hung. onnxruntime-web's glue code was inlined into the worker chunk, so each of the nine thread workers it started loaded the worker chunk itself. The spike's `onmessage` handler then took onnxruntime-web's internal "load" message as a request and started another model download and session in each thread worker, and the run never finished.

## Interpretation

- Vite 8 bundles the module worker and onnxruntime-web's threaded WebAssembly in both dev and production, and the worker is cross-origin isolated with 10 threads.
- The POC's header middleware is no longer needed. Vite 8 applies `server.headers` and `preview.headers` to transformed modules and workers.
- onnxruntime-web must be given `wasmPaths` from `?url` imports in any bundled worker. Without them the thread workers run the application's worker code. This is a property of how onnxruntime-web starts its threads, not of Vite, and other bundlers inline it the same way.
- The SlimSAM encoder numbers come from a zero-filled input in a headless tab and only show that both providers ran. They are not the STACK-017 benchmark, which uses the PathoSAM graphs.

## Follow-ups

- [ADR 0015](../adr/0015-vite-build-tool.md) records the choice.
- The production edge (SKEL-001) must send the same COOP and COEP headers.
- TODO: STACK-017 should reuse this harness for the PathoSAM numbers from doc 14.
