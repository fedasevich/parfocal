# 0311. The click decoder runs on a 32 token window of the embedding around the prompt

- Date: 2026-11-14
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: AISEG-009 (embedding window crop for decoder speed). Builds on [ADR 0246](0246-pathosam-onnx-export-contract.md) (PathoSAM exports to ONNX with the legacy TorchScript exporter) and [ADR 0253](0253-sam-inference-worker.md) (the SAM inference worker)

## Context

POC doc 20 (the review of what the POC is missing), section 2.10, puts the decoder's per-prompt floor at 40 ms and blames attention over all 4,096 image tokens. The AISEG-002 result (quantised SAM variants per execution provider) measured a steady click decode of about 35 ms on WebGPU and 43 ms on WebAssembly with the full decoder. Hover preview and the region pass call the decoder many times per second, so the floor caps both.

## Options considered

1. Crop the client-side embedding to a window and feed it to the current decoder. The current graph computes the dense positional encoding for the 64 by 64 grid, so a smaller embedding does not line up with it. It also means reading the embedding back from the GPU for every click.
2. A second exported graph that takes the full embedding, a `window_origin` in tokens and the same samexporter prompt inputs. It crops the embedding, the dense positional encoding and the dense mask embedding at the same origin with `index_select`, so the legacy tracer cannot freeze the origin, and it returns the window's masks. Points stay in full 1024 pixel coordinates.
3. Keep the full decoder and only lower the hover rate. This leaves the floor where it is.

## Decision

Option 2, a 32 token window, on in `sam.worker.ts`. `python -m parfocal_ml.sam_onnx.export` writes `pathosam.decoder_window32.onnx`, and `--window-sizes 16 24 32` writes other sizes for the bench. In the browser, `embeddingWindow` centres the window on the prompt and returns null, which means the full decoder, when the prompt does not fit inside a 4 token margin or the previous mask reaches outside the window. After a windowed run, `touchesInnerEdge` checks whether the best mask reaches a window edge that is not the patch edge. When it does, the engine reruns the full decoder. `pasteWindowOutputs` puts the window logits back into full-size planes filled with -20, so callers and the worker protocol see the same outputs as before. The engine loads the window graph only with `windowDecoder: true`, which the worker sets, and falls back to the full decoder when the graph is not published.

## Consequences

- The window decoder sees less context, so its masks are an approximation. On 78 TNBC nucleus clicks the [result](../results/2026-11-15-embedding-window-decoder.md) found a mean IoU of 0.9896 with the full decoder and a minimum of 0.945 at 32 tokens, with no edge clicks. The `weights` test keeps the bar at a mean IoU of 0.9.
- The steady click decode in Chrome fell from 32 to 17 ms on WebGPU and from 54 to 14 ms on WebAssembly, below the POC's 40 ms floor. `sam-variants.spec.ts` asserts both bars whenever the window graph is exported.
- 16 and 24 token windows are faster on the CPU but agree less at their worst click, so they stay bench options.
- Prompts larger than the window, such as gland-sized boxes, still pay the full decoder, and an edge rerun pays both. TODO: measure how often that happens in the hover and region-pass benches.
- The model artifact manifest gains one 16.5 MB graph.
