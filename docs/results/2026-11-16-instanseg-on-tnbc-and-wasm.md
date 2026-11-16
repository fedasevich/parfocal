# Result: InstanSeg brightfield nuclei scores PQ 0.712 on TNBC and 0.663 on MoNuSeg test, and its network runs a 512 px tile in 218 to 689 ms on WebAssembly on the M4

- Date: 2026-11-16
- Backlog: AISEG-013 (fast tier in the browser without a GPU)
- Kind: ML evaluation and browser timing
- Commit: the AISEG-013 commit on its worktree branch, on top of 67dfc549
- Environment: MacBook with Apple M4 (10 cores) and 24 GB, macOS 15.8.1, Python 3.14, torch 2.15 on CPU, onnxruntime 1.31.1 on `CPUExecutionProvider`, onnxruntime-web 1.31.1 in headless Google Chrome through Playwright with one worker. No other agent ran during the measurements
- Data: all 50 TNBC v1.1 images (512 by 512, Zenodo 1175282, CC BY 4.0, public, no PHI), 4,053 nuclei, and all 14 MoNuSeg test images (1000 by 1000, CC BY-NC-SA 4.0, reference only), 6,697 nuclei, both from `parfocal_ml.datasets`
- Weights: release `instanseg_models_v0.1.1` of [instanseg/instanseg](https://github.com/instanseg/instanseg/releases/tag/instanseg_models_v0.1.1), asset `brightfield_nuclei.zip`, 15,054,316 bytes, SHA-256 427aa9cfe961b6d0012e2abf6befc6a9f76398db5d28dc2302ad911327d1c448, holding TorchScript `instanseg.pt` with SHA-256 0c724da169d507d8dd2e206ad3675a0b1566824eee6e20ad9a0ba916311d9dd0 (computed, and equal to the one in `rdf.yaml`)

## Question

Is InstanSeg's brightfield nuclei model good enough and fast enough to be the auto tool of the Fast tier when WebGPU is missing? ADR 0361 (interactive encoder and decoder per tier) left that row empty. The pass bar was fixed after a smoke run on three TNBC images (PQ 0.764) and before the full runs: PQ of at least 0.70 on TNBC and on MoNuSeg test, and the network of a 512 px tile under 1 s on WebAssembly. The reference points are the auto region pass on WebGPU, PQ 0.8284 on the same 50 TNBC images and scorer ([auto region result](2026-11-08-auto-region-pass-on-tnbc.md)), and its prompt fallback, PQ 0.7959 ([prompt fallback result](2026-11-16-prompt-fallback-on-tnbc.md)).

## Licence and training data

- `rdf.yaml` in the zip says `license: Apache-2.0`, and the code repository is Apache-2.0.
- `brightfield_nuclei_README.md` in the zip lists the training sets as tnbc_2018 (CC BY 4.0, Zenodo 3552674), LyNSeC (CC BY 4.0, Zenodo 8065174), NuInsSeg (CC BY 4.0, Zenodo 10518968), IHC TMA (CC BY 4.0, Zenodo 7647846) and CoNSeP. For CoNSeP it says "Apache 2.0". That is the InstanSeg README's claim, not a primary source, and the ADR 0042 matrix (model licensing policy, now Rejected) still has CoNSeP as `TODO`.
- ADR 0042 is Rejected and STACK-031 (model licensing policy) is on hold, so this is recorded against the reference matrix, not an enforced gate. Under that matrix's classes every listed licence is `permitted`, and CoNSeP stays `unconfirmed`.

## Method

```
mkdir -p ~/.cache/parfocal/models/instanseg/v0.1.1 && cd ~/.cache/parfocal/models/instanseg/v0.1.1
curl -sSLO https://github.com/instanseg/instanseg/releases/download/instanseg_models_v0.1.1/brightfield_nuclei.zip
shasum -a 256 brightfield_nuclei.zip && unzip -o brightfield_nuclei.zip
pnpm --filter @parfocal/ml bench:instanseg -- --dataset tnbc
pnpm --filter @parfocal/ml bench:instanseg -- --dataset monuseg-test
pnpm --filter @parfocal/ml bench:instanseg -- --dataset tnbc --microns-per-pixel 0.5
pnpm --filter @parfocal/ml export:instanseg
pnpm --filter @parfocal/viewer-engine bench:instanseg --workers=1
```

`parfocal_ml.instanseg` resizes each image from the dataset's 0.25 µm/px to the model's 0.5 µm/px (the scale in `rdf.yaml`), so a 512 px tile becomes a 256 px input. It applies the model's own preprocessing, a per-channel 0.1 to 99.9 percentile stretch, runs the unmodified TorchScript model with its own post-processing, resizes the labels back with nearest neighbour, traces one ring per label and scores them with `parfocal_ml.scoring`, the scorer of the auto region result. The TorchScript model reproduces the zip's shipped test output exactly (all 65,536 labels equal).

`export_network` exports only the network (`model.fcn`, five output maps) to ONNX opset 17 with dynamic height and width, 15,287,201 bytes. It matches TorchScript at a largest absolute difference of 3e-5 on a 256 px input. The post-processing (seed peaks, a small per-seed pixel classifier on 64 px windows, overlap merging) is not in the graph.

The browser bench loads the ONNX network in onnxruntime-web on the `wasm` provider, cross-origin isolated, one page per thread count because the thread count is fixed when the runtime starts, and runs six passes on a seeded random input. Steady is the median of passes two to six.

## Results

Quality, unmodified TorchScript pipeline, pooled over nuclei:

| Set | Input scale | Nuclei | Predicted | Recall | Precision | F1 | PQ | SQ | AJI | Median time per image, torch CPU (ms) |
|---|---|---|---|---|---|---|---|---|---|---|
| TNBC (tnbc_2018 is listed among its training sets) | 0.5 µm/px, 256 px | 4,053 | 3,593 | 0.8367 | 0.9438 | 0.8870 | 0.7121 | 0.8028 | 0.7186 | 199 |
| TNBC, not resized | 0.25 µm/px, 512 px | 4,053 | | 0.7572 | 0.7719 | | 0.6060 | | | 715 |
| MoNuSeg test (not in its training data) | 0.5 µm/px, 500 px | 6,697 | 6,654 | 0.8595 | 0.8650 | 0.8623 | 0.6625 | 0.7684 | 0.6527 | 1,046 |

The network alone on the onnxruntime CPU in Python, fastest of four on a random input: 134 ms on one thread and 47 ms on all cores at 256 px, 549 and 194 ms at 512 px. TorchScript's network took 133 ms at 256 px in the same run, so its post-processing is roughly the rest of the 199 ms median, about 65 ms. That split comes from two different runs and is approximate.

The network on WebAssembly in Chrome, steady ms, in two runs of the bench (second run after the slash):

| Threads | 256 px input (one 512 px tile at 0.25 µm/px) | 512 px input | Session creation (ms) |
|---|---|---|---|
| 1 | 689 / 688 | 2,771 / 2,769 | 231 / 232 |
| 2 | 353 / 353 | 1,565 / 1,444 | 252 / 257 |
| 4 | 225 / 218 | 897 / 866 | 252 / 254 |
| 10, `navigator.hardwareConcurrency` as the app's `createOrtRuntime` sets it, second run only | 226 | 778 | 266 |

The bench's budget test asserts only that the network, without post-processing, runs one tile under 1 s at the app's thread count. A green run of it is not the done-when of AISEG-013, which needs the whole path including post-processing.

## Interpretation

- Quality misses half the bar, so the bar is not met. TNBC passes at 0.712, but tnbc_2018 (Zenodo 3552674) is listed among its training sets. The harness loads TNBC v1.1 (Zenodo 1175282), and whether those are the same images and which split was trained on was not checked. MoNuSeg test, the only set here it did not train on, gives 0.663, below 0.70. PathoSAM trained on MoNuSeg, so no PathoSAM number on MoNuSeg is a fair comparison, and none was run.
- InstanSeg is 0.116 PQ below the WebGPU auto region pass on TNBC, mostly from recall (0.837 against 0.951), with precision about the same (0.944 against 0.955).
- Speed passes the bar on the M4 with room to spare: the network of one tile takes 689 ms on one WebAssembly thread and 225 ms on four. The post-processing still has to run in the browser. If it costs in TypeScript what it costs in TorchScript, about 65 ms, one tile stays under 1 s on one thread on the M4.
- The CI CPU runner was not measured. No CI job runs `playwright.sam.config.ts`, `test:weights` or `test:accuracy`, and none provisions the InstanSeg zip, so the CPU number waits for a job that does. A runner with fewer and slower cores than the M4 could pass 1 s.
- Resizing to the model's 0.5 µm/px matters: running TNBC at its native scale drops PQ to 0.606 and quadruples the time.
- Neither a StarDist model nor a WebAssembly run of the PathoSAM AIS pass was measured here. The PathoSAM encode alone is 5.3 to 5.9 s per tile on WebAssembly per the [provider result](2026-11-06-sam-variants-per-provider.md), about 8 to 26 times slower than the InstanSeg network.
