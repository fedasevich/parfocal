# Result: onnxruntime-web 1.31.1 encodes a PathoSAM field in about 1.1 to 1.3 s and decodes a click in about 30 ms on WebGPU

- Date: 2026-11-02
- Backlog: STACK-017 (browser ML runtime)
- Kind: spike
- Commit: 43be47b (the spike lived in a scratch folder outside the repository and is reproduced below)
- Environment: MacBook with Apple M4 (10 cores), macOS 15.8.1, Node 26.13.0, Google Chrome 156.0.8078.74 driven headless by playwright-core 1.64.0 with `--enable-unsafe-webgpu`. The worker's WebGPU adapter reported vendor `apple`, architecture `metal-3`, so the GPU numbers are Metal and not a software fallback. Localhost, `vite preview`, no network shaping
- Data: the POC's PathoSAM exports from `poc/public/models`, symlinked: `pathosam.encoder_q4.onnx` (4-bit MatMulNBits, 72,564,336 bytes), `pathosam.encoder_quantized.onnx` (uint8 dynamic, 100,286,650 bytes) and `pathosam.decoder.onnx` (16,495,823 bytes). The encoder input is a seeded pseudo-random 1 × 3 × 1024 × 1024 float32 tensor, no slide pixels

## Question

Does the chosen browser runtime reproduce the POC numbers of doc 14 (one-click annotation, interaction, model loading and the browser numbers): a steady encode of about 1.5 s with the 4-bit encoder (1,477 ms) and a steady decode of about 41 ms per click, both on WebGPU? The candidates were onnxruntime-web (WebGPU and WebAssembly), Transformers.js and WebNN.

## Method

A scratch folder with `vite@8.3.5`, `onnxruntime-web@1.31.1` pinned exactly and `playwright-core@1.64.0`. The page and worker are built as in the [Vite worker spike](2026-10-08-vite-worker-wasm-spike.md): COOP `same-origin` and COEP `credentialless` through `server.headers` and `preview.headers`, `worker.format: "es"`, `optimizeDeps.exclude: ["onnxruntime-web"]`, and `env.wasm.wasmPaths` from `?url` imports of `ort-wasm-simd-threaded.asyncify.mjs` and `.wasm`, which 1.31.1 still ships under those names.

The worker, per page load:

1. Imports `onnxruntime-web/webgpu`, sets `env.wasm.numThreads` to `navigator.hardwareConcurrency` and asks `navigator.gpu` for an adapter, recording `adapter.info`.
2. Fetches the decoder and the encoder bytes, then creates the decoder session and only after it the encoder session, with one execution provider. Doc 14 found that creating both at once on WebGPU hangs.
3. Runs the encoder 5 times on the same input. Steady is the median of the last 3.
4. Runs the decoder 12 times with one positive click and the samexporter padding point `(0, 0, -1)`, feeding `image_embeddings` from the last encode, a zero 1 × 1 × 256 × 256 `mask_input`, `has_mask_input` 0 and `orig_im_size` 1024 × 1024, as `poc/src/segment/onnx.ts` does. Each click moves. Steady is the median of runs 3 to 12.

A Playwright script launches Chrome headless with `--enable-unsafe-webgpu`, opens `/?provider=webgpu` (4-bit encoder) or `/?provider=wasm&encoder=pathosam.encoder_quantized.onnx` and reads `window.report`. Commands: `npx vite build`, `npx vite preview --port 4917`, `node run.mjs http://localhost:4917 "provider=webgpu"`.

To separate the runtime version from the machine, the same folder was rebuilt with `onnxruntime-web@1.29.0`, the version the POC had installed when doc 14 was measured, and run twice on WebGPU.

## Results

WebGPU, 4-bit encoder, onnxruntime-web 1.31.1, four page loads, in milliseconds:

| Load | Decoder session | Encoder session | Encode runs | Steady encode | Decode runs | Steady decode |
|---|---|---|---|---|---|---|
| 1 | 594 | 218 | 1,853, 1,088, 1,071, 1,076, 1,089 | 1,076 | 701, 32, 29, 29, 29, 28, 27, 28, 27, 28, 27, 26 | 28 |
| 2 | 598 | 239 | 1,753, 1,179, 1,087, 1,094, 1,101 | 1,094 | 778, 36, 32, 30, 32, 31, 31, 29, 29, 29, 30, 29 | 30 |
| 3 | 576 | 239 | 1,371, 1,173, 1,173, 1,292, 1,259 | 1,259 | 871, 58, 31, 33, 39, 35, 32, 36, 33, 33, 29, 30 | 33 |
| 4 | 578 | 262 | 1,256, 1,205, 1,200, 1,201, 1,255 | 1,201 | 133, 34, 31, 31, 31, 30, 28, 31, 31, 31, 33, 33 | 31 |

WebGPU, 4-bit encoder, onnxruntime-web 1.29.0, same machine and harness:

| Load | Decoder session | Encoder session | Encode runs | Steady encode | Decode runs | Steady decode |
|---|---|---|---|---|---|---|
| 1 | 724 | 342 | 2,168, 1,759, 1,660, 1,603, 1,597 | 1,603 | 882, 58, 38, 42, 37, 36, 41, 37, 31, 30, 30, 31 | 37 |
| 2 | 725 | 361 | 1,960, 2,100, 1,811, 1,745, 1,795 | 1,795 | 166, 55, 43, 47, 40, 44, 45, 44, 40, 38, 40, 70 | 44 |

WebAssembly, uint8 encoder, onnxruntime-web 1.31.1, one page load, 10 threads:

| Decoder session | Encoder session | Encode runs | Steady encode | Steady decode |
|---|---|---|---|---|
| 517 | 299 | 5,930, 5,426, 5,953, 5,531, 5,496 | 5,531 | 44 |

Against doc 14:

| Measure | POC (doc 14, 1.29) | 1.29.0 here | 1.31.1 here |
|---|---|---|---|
| Steady encode, 4-bit, WebGPU | 1,477 ms | 1,603 and 1,795 ms | 1,076 to 1,259 ms |
| Steady decode, WebGPU | 41 ms | 37 and 44 ms | 28 to 33 ms |
| Decoder session create, WebGPU | 673 ms | 724 and 725 ms | 576 to 598 ms |
| Steady encode, uint8, WebAssembly | 30,244 ms first run, hidden tab, 8 threads | not run | 5,531 ms, foreground headless, 10 threads |
| Steady decode, WebAssembly | 247 ms, hidden tab | not run | 44 ms |

Other facts from every run: `crossOriginIsolated` was true in the page and the worker, the worker had 10 threads, the decoder's inputs were `image_embeddings`, `point_coords`, `point_labels`, `mask_input`, `has_mask_input` and `orig_im_size`, and the encoder's only output was `image_embeddings`. `"ml" in navigator` was true, but Chrome was launched with `--enable-features=WebMachineLearningNeuralNetwork`, so that says nothing about a default Chrome.

## Interpretation

- The spike reproduces the POC numbers. With 1.29.0, the POC's version, this machine gives 1.6 to 1.8 s and 37 to 44 ms, close to doc 14's 1,477 ms and 41 ms. With 1.31.1 the same graphs run faster, about 1.1 to 1.3 s per encode and about 30 ms per click, so moving to 1.31.1 costs nothing and gains about a quarter on encode.
- The first decode after an encode costs 130 to 880 ms on WebGPU in every load. A real viewer should warm the decoder with one dummy click after the encoder session is ready, so the user's first click lands at the steady cost.
- WebAssembly is far faster here than in doc 14 because doc 14's tab was hidden and its CPU was shared with a node run. The 5.5 s encode is the foreground fallback figure, still too slow to feel like one click, so WebAssembly stays a fallback.
- Load-to-load spread on WebGPU is about 200 ms on encode. Four loads are enough to say "reproduces", not to rank versions finely.
- Transformers.js and WebNN were not measured. Why they were not chosen is in [ADR 0148](../adr/0148-browser-ml-runtime-onnxruntime-web.md).
- Assumption: a pseudo-random input times the same as a real slide patch, because the graphs have no data-dependent control flow. Mask quality was not checked here. Doc 13 and doc 14 measured it for these exact graphs.

## Follow-ups

- [ADR 0148](../adr/0148-browser-ml-runtime-onnxruntime-web.md) records onnxruntime-web 1.31.1 with the 4-bit graph on WebGPU and the uint8 graph on WebAssembly.
- `apps/web` does not depend on onnxruntime-web yet. The first task that loads a model in the web app adds `onnxruntime-web@1.31.1` to `apps/web/package.json`.
- TODO: a WebNN measurement once Chrome ships it without a flag.

## Spike source

`src/worker.ts`, the part that matters:

```ts
import * as ort from "onnxruntime-web/webgpu";
import mjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

ort.env.wasm.wasmPaths = { mjs, wasm };
ort.env.wasm.numThreads = navigator.hardwareConcurrency;

const executionProviders = [provider];
const decoder = await ort.InferenceSession.create(decoderBytes, { executionProviders });
const encoder = await ort.InferenceSession.create(encoderBytes, { executionProviders });

for (let run = 0; run < 5; run++) {
  embeddings = await encoder.run({ [encoder.inputNames[0]]: input });
}

for (let run = 0; run < 12; run++) {
  const feeds = {
    image_embeddings: embeddings.image_embeddings,
    point_coords: new ort.Tensor("float32", Float32Array.from([x, y, 0, 0]), [1, 2, 2]),
    point_labels: new ort.Tensor("float32", Float32Array.from([1, -1]), [1, 2]),
    mask_input: new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor("float32", Float32Array.from([0]), [1]),
    orig_im_size: new ort.Tensor("float32", Float32Array.from([1024, 1024]), [2]),
  };
  await decoder.run(feeds);
}
```

`run.mjs`:

```js
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-webgpu", "--enable-features=Vulkan,WebMachineLearningNeuralNetwork"],
});
const page = await browser.newPage();
await page.goto(`${base}/?${query}`);
await page.waitForFunction(() => window.report, null, { timeout: 600000 });
```
