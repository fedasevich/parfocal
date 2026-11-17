# Result: PathoSAM browser graphs match PyTorch on fixed TNBC patches in Chrome

- Date: 2026-11-15
- Backlog: MLEVAL-007 (browser parity tests)
- Kind: check
- Commit: f8f86311 plus the MLEVAL-007 change on its branch
- Environment: MacBook with Apple M4 (10 cores), macOS 15, Google Chrome driven headless by `@playwright/test` 1.64.0 with `--enable-unsafe-webgpu`, onnxruntime-web 1.31.1. The WebGPU adapter reported vendor `apple`, architecture `metal-3`. The page was cross-origin isolated. Other agents shared the machine, so times are indicative only
- Data: the first 6 TNBC patches (public, no PHI, 512 by 512, all from image `01`) with 8 nucleus clicks each, 48 clicks in all. PyTorch outputs come from `vit_b_histopathology.pt` and `vit_b_histopathology_decoder.pt` with the SHA-256 values pinned in `sam_contract.py`. Graphs are the ones in `~/.cache/parfocal/models/onnx`, their SHA-256 written into the fixture manifest

## Question

Do the quantised graphs the browser actually runs, on the provider that runs them, give the same masks as PyTorch? The 2026-11-06 [PathoSAM export result](2026-11-06-pathosam-onnx-export.md) answered this for onnxruntime on CPU in Python only.

## Method

```
pnpm --filter @parfocal/ml parity:fixture -- --patches 6 --clicks 8
pnpm --filter @parfocal/viewer-engine parity:sam
```

`parity_fixture.py` runs `torch_references` from `verify.py` and writes, per patch, the exact `pixel_values` tensor, the PyTorch image embeddings, the PyTorch best-of-three click masks and the PyTorch AIS maps to `~/.cache/parfocal/datasets/sam-parity`, with the contract thresholds and graph checksums in `manifest.json`. `sam-parity.spec.ts` feeds the same `pixel_values` tensor to the provider's encoder in Chrome, so preprocessing differences do not enter the measure, then runs `pathosam.decoder.onnx` per click with a square `orig_im_size` and picks the best multimask output as Python does. Each AIS decoder the provider may run is fed twice, once with the PyTorch embeddings (the AIS graph alone) and once with the browser's own embeddings (encoder and AIS together). Foreground is AIS channel 0 above 0.5. The test fails when the mean click IoU or any mean AIS foreground IoU is under 0.96, the `QUANTISED_MIN_IOU` and `AIS_QUANTISED_MIN_IOU` of the contract.

## Results

Clicks, browser encoder then `pathosam.decoder.onnx`, against PyTorch:

| Provider | Encoder | Embedding max abs diff | Clicks with IoU 1.0 | Min IoU | Mean IoU | Encode (ms, median) | Decode (ms, median) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WebGPU | encoder q4 | 0.249 | 1 of 48 | 0.8494 | 0.9625 | 1,451 | 37 |
| WebAssembly | encoder uint8 | 0.124 | 4 of 48 | 0.9444 | 0.9822 | 7,006 | 49 |

AIS maps against PyTorch, max abs diff and mean (min) foreground IoU over 6 patches:

| Provider | AIS graph | From PyTorch embeddings | From browser embeddings |
| --- | --- | --- | --- |
| WebGPU | ais_decoder fp32 | 0, 1.0 (1.0) | 0.99, 0.9732 (0.9673) |
| WebGPU | ais_decoder int8 weights | 0.023, 0.9994 (0.9988) | 0.99, 0.9732 (0.9672) |
| WebAssembly | ais_decoder fp32 | 0.002, 0.9999 (0.9998) | 0.742, 0.9861 (0.9810) |
| WebAssembly | ais_decoder int8 weights | 0.023, 0.9994 (0.9988) | 0.747, 0.9861 (0.9810) |
| WebAssembly | ais_decoder uint8 | 0.06, 0.9994 (0.9991) | 0.75, 0.9861 (0.9812) |

Both tests passed. The uint8 AIS graph was not run on WebGPU because `graphRunsOn` refuses it there.

## Interpretation

The browser graphs agree with PyTorch within the contract on both providers. The AIS decoders add almost nothing of their own, since from PyTorch embeddings every one keeps a foreground IoU of at least 0.9988. Nearly all the loss comes from the quantised encoders. The WebGPU q4 path gives a click mean IoU of 0.9625, close to the 0.9614 the q4 graph gave on CPU in Python, so WebGPU itself adds no measurable error, but it clears the 0.96 bar by only 0.0025. A slightly different patch set could fail it, as the Python gate already saw on 4 patches. The WebAssembly uint8 path keeps a wide margin. These checks are a fixed set from one TNBC image, which measures parity, not accuracy across tissue.

The test needs the graphs and the fixture, which are not in the repository. Without them it skips, and with `PARFOCAL_REQUIRE_SAM_PARITY=1` it fails instead, so a CI job that provides them cannot pass silently.

## Update 2026-11-18, CI reads the files from R2

Under decision 107 (model files for the browser parity test), the six graphs and the 25 fixture files above, 394,073,414 bytes, were uploaded once to `parfocal-dev/fixtures/sam-parity/onnx/` and `fixtures/sam-parity/dataset/` with `If-None-Match: *`. Their SHA-256 and sizes are pinned in `packages/viewer-engine/sam-bench/parity-files.json`. `pnpm --filter @parfocal/viewer-engine parity:fetch wasm` downloads only what the WebAssembly test runs (about 322 MB, no q4 encoder) with the read-only key of decision 132 and checks every checksum. Read back that way into empty folders on the Mac, the WebAssembly test passed again in 4.0 minutes with the same numbers as the table above (click mean IoU 0.9822, min 0.9444, AIS foreground IoU 0.9861 from browser embeddings). The `sam-parity` workflow runs that test on a GitHub runner on pull requests that touch the SAM code or the parity files, on `main` and weekly. The first runner numbers are `TODO` until that workflow has run once.
