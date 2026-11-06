# XXXX. One inference worker creates sessions one at a time and answers only the latest prompt

- Date: 2026-11-06
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: AISEG-004 (inference worker). Builds on [ADR 0148](0148-browser-ml-runtime-onnxruntime-web.md) (browser models on onnxruntime-web 1.31.1), [ADR 0250](0250-sam-graph-per-execution-provider.md) (each execution provider loads its own PathoSAM graphs) and [ADR 0251](0251-browser-model-cache-in-cache-storage.md) (browser models are cached in Cache Storage)

## Context

The smart select tool, the hover preview, the embedding prewarm and the auto region tool all talk to the same PathoSAM encoder and decoder. Creating two onnxruntime-web sessions at once hangs on WebGPU (POC doc 14). A user who moves the pointer or clicks quickly sends prompts faster than the decoder answers, and an answer for a point that is no longer the latest would flash a wrong outline.

## Options considered

1. One module worker that owns the sessions, with an engine behind a small runtime interface, a session lock and a run lock.
2. One worker per model, each with its own sessions.
3. Sessions on the main thread.

## Decision

Option 1. `createInferenceEngine` in `packages/viewer-engine/src/sam/inference-engine.ts` holds the logic. `startSamWorker` and `createSamClient` carry it across a worker boundary, and `sam.worker.ts` is the only file that imports onnxruntime-web, through `ort-runtime.ts`.

- The provider comes from one `navigator.gpu.requestAdapter()` call and `samProvider`. If the WebGPU sessions fail to load, the engine retries once on WebAssembly and reports that it fell back.
- Every session is created under one session lock, the decoder first and then the encoder, each after its graph arrives from the model cache. The AIS decoder is created on its first use under the same lock, so two sessions never initialise at once.
- Decoder inputs come from `session.inputNames`. The engine fills the six samexporter names, leaves out any the graph does not declare, and throws `UnsupportedGraphInputError` for a name it does not know. The encoder input is `inputNames[0]` and the embedding output is `image_embeddings` or the first output.
- Encodes, prompts and AIS runs share one run lock, so no two graphs run at once. Each prompt takes a sequence number. A prompt that is no longer the newest when its turn comes is skipped without running, and one that is overtaken while running has its answer dropped and replies `stale`.
- Embeddings stay in the worker under a caller id, up to six, with the least recently used one disposed first. A prompt counts as a use.
- The decoder is warmed with one dummy click on a zero embedding once both sessions exist.

## Consequences

- A caller must treat `stale` as "ask again only if the prompt is still wanted", not as an error.
- A caller sends pixels already normalised to 3 x 1024 x 1024 floats. Cropping and normalising belong to the smart select tool.
- Skipping queued prompts means only the last pointer position in a burst costs a decode.
- `onnxruntime-web` moves from a development dependency to a dependency of `@parfocal/viewer-engine`, at the same pinned version.
- A real graph smoke check was not run in this task. The timings stay those of the AISEG-002 result file.
