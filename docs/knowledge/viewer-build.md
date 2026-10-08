# Web build

Lessons about bundling the web app, its workers and WebAssembly with Vite ([ADR 0015](../adr/0015-vite-build-tool.md)).

## onnxruntime-web needs wasmPaths in a bundled worker

When a worker imports onnxruntime-web, Vite inlines its WebAssembly glue into the worker chunk. onnxruntime-web starts its thread pool by loading the current script again, so every thread worker runs the application's worker code. An `onmessage` handler there takes onnxruntime-web's internal "load" message as an application request, and the session never finishes. There is no error. Set the paths so the threads load onnxruntime-web's own file:

```ts
import mjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

ort.env.wasm.wasmPaths = { mjs, wasm };
```

Use the `jsep` or `jspi` files instead when importing those builds. Source: [STACK-001 spike](../results/2026-10-08-vite-worker-wasm-spike.md).

## Vite 8 applies server.headers to modules and workers

The POC needed a middleware plugin for COOP and COEP because `server.headers` skipped transformed modules, and Chrome silently refused the module worker. In Vite 8.3, `server.headers` and `preview.headers` reach the HTML, modules, worker scripts and public files, and the worker runs isolated. Source: [STACK-001 spike](../results/2026-10-08-vite-worker-wasm-spike.md).

## Headless Chrome on a Mac has real WebGPU

playwright-core with `channel: "chrome"` drives the installed Chrome without downloading a browser, and with `--enable-unsafe-webgpu` headless pages get the `apple metal-3` adapter. Hosted Linux CI does not, which is why golden images use SwiftShader there ([ADR 0011](../adr/0011-hosted-ci-only.md)).

## StrictMode exposes a leaking canvas host on the first mount

In development StrictMode mounts, unmounts and remounts every effect. A viewer host whose cleanup does not destroy the engine shows two WebGL contexts and two canvases right after the first mount. A production build hides that until Chrome forcibly loses contexts once 16 are alive. Count contexts by wrapping `HTMLCanvasElement.prototype.getContext` and listening for `webglcontextlost`. Source: [STACK-002 spike](../results/2026-10-08-react-compiler-strictmode-spike.md).
