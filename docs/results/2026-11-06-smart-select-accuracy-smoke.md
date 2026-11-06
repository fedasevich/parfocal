# Result: Smart select accuracy smoke on 78 TNBC nuclei in Chrome

- Date: 2026-11-06
- Backlog: AISEG-005 (smart select tool)
- Kind: ML evaluation
- Commit: bc96ea7c plus the AISEG-005 smoke test change on its branch
- Environment: MacBook with Apple M4, macOS 15.8.1, Google Chrome driven headless by `@playwright/test` 1.64.0 with `--enable-unsafe-webgpu`, onnxruntime-web 1.31.1. The WebGPU adapter reported vendor `apple`, architecture `metal-3`. The page was cross-origin isolated. Other agents shared the machine, so times are indicative only
- Data: the first 8 TNBC patches (512 by 512 pixels, public, no PHI) from `parfocal_ml.datasets`. Per patch up to 10 nuclei of at least 30 pixels, chosen evenly across the instance labels, 78 in all. The graphs are the ones from `python -m parfocal_ml.sam_onnx.export` in `~/.cache/parfocal/models/onnx`

## Question

Does the smart select pipeline in the browser reach the accuracy the POC measured for PathoSAM on TNBC? The baseline is POC doc 26 (held-out benchmarks) on TNBC with PathoSAM and contour outlines: one realistic click 0.851, one ideal click 0.851, one exact box 0.863 and three clicks from the realistic click 0.884, all mean IoU per nucleus. No MLEVAL result covers interactive prompts yet, because MLEVAL-003 (interactive protocol) is still open.

## Method

```
pnpm --filter @parfocal/ml smoke:fixture
pnpm --filter @parfocal/viewer-engine smoke:smart-select
```

`smoke:fixture` writes the patches, their instance labels and, for every nucleus, its bounding box and a realistic click into `~/.cache/parfocal/datasets/smart-select-smoke`. The realistic click is the centroid plus a Gaussian miss with sigma 0.35 of the equivalent radius, redrawn until it lands inside the nucleus (seed 20261106), as in doc 26.

The browser page runs the real `createInferenceEngine` with onnxruntime-web on the main thread, one provider per page load. It prepares pixels with `samPixels` (bilinear resize to 1024, the SAM mean and standard deviation), encodes each patch once, and prompts through the engine. It picks the best of the four candidate masks with `bestMask` and thresholds its 1024 by 1024 logits at 0. Four prompts per nucleus, scored by pixel IoU against the instance label upsampled by nearest neighbour to 1024 by 1024.

- Ideal click: the deepest interior pixel of the label (a chamfer distance transform).
- Realistic click: the click from the fixture.
- Exact box: the label's bounding box, passed as a box prompt, never derived from a mask.
- Three clicks: the realistic click, then two corrective clicks at the deepest pixel of the error region (positive on a missed pixel, negative on an extra one), each run feeding the previous low-resolution logits through `mask_input`.

WebGPU used the 4-bit encoder and the decoder. WebAssembly used the uint8 encoder and the same decoder. The spec fails when a mean falls more than two standard errors of that mean below the POC number, and it skips when the graphs or the fixture folder are absent. It is run on its own, never together with `pnpm verify`.

## Results

Mean IoU per nucleus over 78 nuclei. The standard error of each mean was 0.004 to 0.005. The POC column is the baseline.

| Prompt | POC doc 26 | WebGPU, 4-bit encoder | WebAssembly, uint8 encoder |
|---|---|---|---|
| Ideal click | 0.851 | 0.912 | 0.915 |
| Realistic click | 0.851 | 0.913 | 0.917 |
| Exact box | 0.863 | 0.926 | 0.928 |
| Three clicks | 0.884 | 0.926 | 0.925 |

Lowest single nucleus: realistic click 0.776 on WebGPU and 0.792 on WebAssembly, so every one of the 78 nuclei reached 0.75 on every prompt. Mean after each click of the three-click run: 0.913, 0.922, 0.926 on WebGPU and 0.917, 0.921, 0.925 on WebAssembly.

Timing in the browser (second WebGPU run, first WebAssembly run): encode median 1,311 ms on WebGPU (maximum 1,929) and 5,467 ms on WebAssembly (maximum 6,133). Decode median 36 ms on WebGPU (95th percentile 48.5) and 41 ms on WebAssembly (49.8), over 390 decodes each. The first WebGPU run printed a median encode of 1,100 ms and the same IoU means to the third decimal.

## Interpretation

The baseline is met on both providers for every prompt. The numbers are higher than the POC's, and the two are not the same measurement. This run scores the thresholded mask as a pixel set. The POC scored contour rings through the geometric scorer, which the POC measured as stricter: the same document gives ground truth traced through pixel centres 0.897 on TNBC. The run also uses 8 patches and 78 nuclei, not the whole set. Treat it as a smoke test that the pipeline is wired correctly, not as a replacement for the interactive protocol (MLEVAL-003). The ordering holds as in the POC: a box and three clicks beat one click, the realistic click costs nothing against the ideal one, and each corrective click helps a little.

The quantised encoders cost nothing visible here. The 4-bit encoder had the lower minimum IoU against PyTorch in the export gate, but on these 78 nuclei its prompts score within 0.004 of the uint8 encoder.

## Follow-ups

- MLEVAL-003 (interactive protocol) should reproduce doc 26 with the geometric scorer on the contour outlines the tool draws, and replace this baseline.
- The smoke compares pixel masks, not the traced outlines the tool saves. A check of the traced ring against the label with the geometric scorer is the next step for that task.
