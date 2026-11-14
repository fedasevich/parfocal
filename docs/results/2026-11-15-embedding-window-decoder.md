# Result: The window decoder cuts a click decode to 14 to 17 ms in Chrome and agrees with the full decoder at a mean IoU of 0.99

- Date: 2026-11-15
- Backlog: AISEG-009 (embedding window crop for decoder speed)
- Kind: benchmark
- Commit: f740883e plus a `window_check` fix on the AISEG-009 branch
- Environment: MacBook with Apple M4 (10 cores), macOS 15.8.1, Google Chrome driven headless by `@playwright/test` 1.64.0 with `--enable-unsafe-webgpu`, onnxruntime-web 1.31.1. The WebGPU adapter reported vendor `apple`, architecture `metal-3`. The page was cross-origin isolated and WebAssembly ran 10 threads. Other agents shared the machine, so times are indicative only. Python ran onnxruntime 1.31.1 on the CPU provider with torch 2.15.0
- Data: the PathoSAM checkpoints already cached in `~/.cache/parfocal/models`, so nothing was downloaded. Agreement used the first 8 TNBC patches (public, no PHI). The browser input is the bench's seeded pseudo-random 1 × 3 × 1024 × 1024 tensor

## Question

POC doc 20 (the review of what the POC is missing), section 2.10, puts the decoder's floor at 40 ms per prompt. Does a decoder that attends only to a window of the embedding around the prompt get below 40 ms in the browser, and how close are its masks to the full decoder's?

## Method

1. `uv run --package parfocal-ml --extra export python -m parfocal_ml.sam_onnx.export --window-sizes 16 24 32` exported `pathosam.decoder_window16.onnx`, `pathosam.decoder_window24.onnx` and `pathosam.decoder_window32.onnx`, each 16.5 MB.
2. `python -m parfocal_ml.sam_onnx.window_check --sizes 16 24 32` encoded each patch with the fp32 encoder. It then decoded up to 10 nucleus clicks per patch (the deepest point of each nucleus) with both the full decoder and the window decoder. The window was centred on the click as `embeddingWindow` does. IoU compares the best of the three multimask outputs at 1024 by 1024 after the window logits are pasted back. A click whose best window mask reached an inner window edge counts as an edge click and is left out of the IoU, because the engine reruns the full decoder for it.
3. `pnpm exec playwright test -c playwright.sam.config.ts sam-variants.spec.ts --workers=1` in `packages/viewer-engine`. For each provider, the bench decodes 12 moving clicks with the full decoder, then 12 more with `pathosam.decoder_window32.onnx` on the same embedding. Steady is the median of runs 3 to 12.

## Results

Agreement with the full decoder on 78 TNBC clicks, with CPU decode times from onnxruntime in Python:

| Window (tokens) | Edge clicks | Mean IoU | Min IoU | Full decoder, median ms | Window decoder, median ms |
| --- | --- | --- | --- | --- | --- |
| 16 | 1 | 0.9891 | 0.9136 | 43.7 | 6.2 |
| 24 | 0 | 0.9894 | 0.9349 | 43.6 | 9.7 |
| 32 | 0 | 0.9896 | 0.9450 | 43.2 | 14.8 |

Click decode in Chrome, 32 token window, in milliseconds:

| Provider and encoder | Full decoder runs | Window decoder runs | Steady full | Steady window |
| --- | --- | --- | --- | --- |
| WebGPU, 4-bit encoder | 1650, 54, 35, 35, 33, 32, 33, 30, 31, 31, 32, 30 | 77, 18, 16, 16, 16, 17, 19, 17, 17, 18, 19, 23 | 32 | 17 |
| WebAssembly, uint8 encoder | 86, 52, 69, 44, 56, 56, 80, 54, 52, 52, 43, 54 | 14, 17, 14, 15, 14, 14, 13, 14, 15, 15, 13, 17 | 54 | 14 |

The window session took 155 ms to create on WebGPU and 141 ms on WebAssembly. Its `low_res_masks` came back as 1 × 4 × 128 × 128. Both bench tests passed, including the spec's assertions that the steady window decode is below 40 ms and below the full decoder.

## Interpretation

- The 32 token window meets the 40 ms bar on both providers, at about half the full decoder's time on WebGPU and a quarter on WebAssembly. The first WebGPU window run (77 ms) is a cold run, which the engine's warm-up click covers.
- Its masks match the full decoder at a mean IoU of 0.99 and at least 0.945 on every click, against the 0.9 bar in `WINDOW_MIN_IOU`. Smaller windows are faster on the CPU but their worst click is worse, and 16 tokens had one edge click. 32 tokens stays the default.
- The steady full decode on WebAssembly (54 ms) is slower than the 43 ms the AISEG-002 result measured. Assumption: other agents loaded the machine. The window and full timings in each row ran in the same page, minutes apart.
- Nuclei in TNBC are small next to a 512 pixel window. Larger structures, such as glands at a lower magnification, will hit the edge more often and fall back to the full decoder. That has not been measured.

## Follow-ups

- ADR XXXX (the click decoder runs on a window of the embedding) is Accepted with these numbers, and `sam.worker.ts` turns the window decoder on.
- TODO: the edge-click share on gland-sized prompts, to be measured in the hover and region-pass benches once those run with the window decoder.
