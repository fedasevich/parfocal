# Result: the exported InstanSeg path in the browser scores PQ 0.7121 on TNBC, equal to TorchScript, and segments a 512 px tile in 248 ms on WebAssembly on the M4

- Date: 2026-11-16
- Backlog: AISEG-021 (InstanSeg post-processing in the browser)
- Kind: ML evaluation and browser timing
- Commit: the AISEG-021 commit on its worktree branch, on top of 305853ae
- Environment: MacBook with Apple M4 (10 cores) and 24 GB, macOS 15.8.1, onnxruntime-web 1.31.1 on the `wasm` provider in headless Google Chrome through Playwright with one worker, cross-origin isolated. No other agent ran during the measurements
- Data: all 50 TNBC v1.1 images (512 by 512, Zenodo 1175282, CC BY 4.0, public, no PHI), 4,053 nuclei, and the zip's own `test-input.npy` and `test-output_instance_segmentation.npy` (256 by 256)
- Weights: `brightfield_nuclei.zip` of release `instanseg_models_v0.1.1`, SHA-256 427aa9cfe961b6d0012e2abf6befc6a9f76398db5d28dc2302ad911327d1c448, the same as the [AISEG-013 result](2026-11-16-instanseg-on-tnbc-and-wasm.md)

## Question

ADR 0362 (Fast tier auto tool without WebGPU is deferred) lets InstanSeg into the Fast tier when its post-processing runs in the browser and scores within 0.01 PQ of the TorchScript 0.712 on the 50 TNBC images, when the whole path segments a 512 px tile in under 1 s on WebAssembly on the CI CPU runner at the app's thread count, and when the owner answers decision 134 (whether InstanSeg is accurate enough as the auto tool without WebGPU).

## Method

The post-processing is a TypeScript port in `packages/viewer-engine/src/instanseg/`, not a second graph. `input.ts` resizes like Pillow's bilinear filter, stretches each channel between its 0.1 and 99.9 percentiles like numpy, clamps to the model's range of -2 to 3 and reflect-pads to a multiple of 16. `labels.ts` turns the five network maps into labels the way the TorchScript `forward` does: seed peaks in an 11 px window above 0.7, the 4 to 5 to 5 to 1 pixel classifier on a 64 px window per seed, the flood fill from the seed and the hole fill, the highest probability per pixel, and merging of seeds whose masks overlap by more than 0.3 of the smaller one. It classifies only the pixels the flood fill reaches, which gives the same labels because every other window pixel is zeroed afterwards. `pnpm --filter @parfocal/ml export:instanseg` now writes `instanseg-postprocess.json` (classifier weights and thresholds from the TorchScript model) next to the ONNX network.

```
pnpm --filter @parfocal/ml export:instanseg
pnpm --filter @parfocal/ml bench:instanseg --dataset tnbc --dump-tiles ~/.cache/parfocal/datasets/instanseg-tnbc
pnpm --filter @parfocal/viewer-engine exec playwright test -c playwright.sam.config.ts instanseg-path --workers=1
pnpm --filter @parfocal/ml bench:instanseg --dataset tnbc --labels-from ~/.cache/parfocal/datasets/instanseg-tnbc
```

The dump writes the raw RGB tiles. The browser runs the whole exported path on each, preprocessing, network and labels, and writes the labels at the model scale. Python scores them with the same `full_size`, `rings_of` and scorer as the TorchScript run. The timing tile is the zip's test input stretched to 8 bits and doubled to 512 px, so it holds real nuclei (344 seeds), and it is timed six times per page with the median of runs two to six reported.

## Results

Quality on the 50 TNBC images, pooled over nuclei:

| Path | Predicted | Recall | Precision | F1 | PQ | SQ | AJI |
|---|---|---|---|---|---|---|---|
| TorchScript, AISEG-013 | 3,593 | 0.8367 | 0.9438 | 0.8870 | 0.7121 | 0.8028 | 0.7186 |
| Exported, browser WebAssembly with TypeScript post-processing | 3,593 | 0.8367 | 0.9438 | 0.8870 | 0.7121 | 0.8028 | 0.7186 |

All values agree to the fourth decimal. On the zip's shipped test output the exported path agrees on all 65,536 pixels and finds the same 336 nuclei, from 338 seeds.

Whole path for one 512 px tile at 0.25 µm/px on WebAssembly, steady median ms:

| Threads | Prepare | Network | Labels | Total | First run | Session creation |
|---|---|---|---|---|---|---|
| 1 | 11 | 689 | 13 | 713 | 817 | 256 |
| 10, `navigator.hardwareConcurrency` as the app sets it | 12 | 213 | 14 | 248 | 415 | 260 |

Over the 50 TNBC tiles at 10 threads the median whole path took 215 ms per tile. A first version that classified every window pixel took 196 to 209 ms for the labels step alone and gave the same PQ.

CI CPU runner: `TODO`, waiting for the first run of the new `instanseg` workflow, which fetches the zip by its checksum, exports, and runs `bench:instanseg` with the whole path budget test.

## Interpretation

- Rule 1 of ADR 0362 is met: the exported path scores PQ 0.7121, a difference of 0.0000 from TorchScript.
- Rule 2 is met on the M4 with room to spare, 248 ms at the app's thread count and 713 ms on one thread, but the rule names the CI CPU runner, which has not run yet. The network is 86% of the time at 10 threads and 97% at one, so a runner with fewer, slower cores will be judged mostly by the network.
- Rule 3 is unchanged. Decision 134 is open, so InstanSeg is not the default auto tool, and nothing in the app or the SAM worker calls the new module yet.
