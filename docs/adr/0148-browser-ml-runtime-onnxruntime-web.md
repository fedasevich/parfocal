# 0148. Browser models run on onnxruntime-web 1.31.1, with 4-bit MatMulNBits graphs on WebGPU and uint8 graphs on WebAssembly

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: STACK-017 (browser ML runtime). Builds on [ADR 0015](0015-vite-build-tool.md) (Vite 8 with cross-origin isolated module workers). Touches the one-click segmentation and AINUC tasks that load models in the viewer

## Context

The viewer runs the PathoSAM encoder and decoder in the browser for one-click annotation. POC doc 14 (one-click annotation, interaction, model loading and the browser numbers) found that the WebGPU and WebAssembly providers want opposite graphs: WebGPU has no kernels for the integer operators of a dynamic uint8 graph and runs it 43 times slower than a 4-bit `MatMulNBits` graph, while WebAssembly runs the uint8 graph about 40% faster than the 4-bit one. The 4-bit graph costs no measurable accuracy (doc 14, against doc 13's 6,330 nuclei). The POC used onnxruntime-web 1.29.

## Options considered

1. onnxruntime-web, latest stable 1.31.1, with the WebGPU and WebAssembly execution providers. It runs the POC's own ONNX exports unchanged, including the samexporter decoder contract the POC code fills. The [spike](../results/2026-11-02-browser-ml-runtime.md) measured a steady encode of 1.1 to 1.3 s and a decode of 28 to 33 ms per click on WebGPU, faster than the POC's 1,477 ms and 41 ms.
2. Transformers.js 4.3. It runs on onnxruntime-web underneath and pins its own version of it, and its SAM pipeline expects Hugging Face format models with their processor configs, not the POC's exports and their input contract. It adds a pipeline layer the viewer does not use and takes the runtime version out of our hands. Not measured.
3. WebNN. Chrome exposes `navigator.ml` only behind a flag, and Safari and Firefox do not ship it. onnxruntime-web can reach it later as one more execution provider, so it is not an alternative to option 1. Not measured.

## Decision

Option 1. Models in the browser run on `onnxruntime-web@1.31.1`, pinned exactly, imported from `onnxruntime-web/webgpu` inside a module worker.

- The provider is chosen once by asking `navigator.gpu` for an adapter. With an adapter the worker uses WebGPU and the 4-bit `MatMulNBits` encoder. Without one it uses WebAssembly with all hardware threads and the uint8 dynamic encoder. The decoder graph is the same for both.
- The decoder session is created before the encoder session, never both at once, because concurrent creation on WebGPU hangs (doc 14).
- The worker sets `env.wasm.wasmPaths` from `?url` imports, as [knowledge/viewer-build.md](../knowledge/viewer-build.md) says.
- The decoder is warmed with one dummy click once the encoder is ready, because the first decode costs up to 880 ms.
- A version bump reruns the spike and must keep encode and decode at or below the numbers in the result file.

## Consequences

- The viewer keeps two encoder graphs per model (73 MB and 100 MB for PathoSAM) and downloads only the one its provider uses.
- The WebAssembly binary is 28.7 MB in 1.31.1 and is fetched only when a model is first used.
- `apps/web` gets the dependency from the first task that loads a model, not from this one.
- WebNN can be added later as another execution provider in the same runtime, behind a measurement.
