# XXXX. The Fast tier auto tool without WebGPU is deferred, with InstanSeg brightfield nuclei as the named candidate, because it misses its quality bar on the one set it did not train on and its post-processing is not yet in the browser

- Date: 2026-11-16
- Status: Accepted
- Deciders: Yurii Fedas, proposed by the agent doing AISEG-013 (fast tier in the browser without a GPU)
- Backlog: AISEG-013. Fills in the Fast region row that [ADR 0361](0361-interactive-encoder-and-decoder-per-tier.md) (interactive encoder and decoder per tier) left to this task. Touches [ADR 0202](0202-v1-model-line-up-per-tier.md) (v1 model line-up per tier) and [ADR 0349](0349-nucleus-detector-and-typer-per-tier.md) (nucleus detector and typer per tier), which named InstanSeg as unmeasured

## Context

AISEG-013 asks for a small instance model, InstanSeg or StarDist exported to ONNX, as the default auto tool when WebGPU is missing. It is done when the WebAssembly path segments a 512 px tile in under 1 s on the CI CPU runner, or when an ADR defers it. POC doc 20 section 2.4 (a learned batch provider in the browser) proposed the idea and expected well under a second on WebAssembly. Without WebGPU the auto region tool today has only the PathoSAM AIS pass on WebAssembly, whose encode alone takes 5.3 to 5.9 s per tile on the M4.

## Evidence

All from the [InstanSeg result](../results/2026-11-16-instanseg-on-tnbc-and-wasm.md). Weights are release `instanseg_models_v0.1.1`, `brightfield_nuclei.zip`, 15 MB, Apache-2.0 per its `rdf.yaml`, trained on TNBC 2018, LyNSeC, NuInsSeg, IHC TMA (all CC BY 4.0) and CoNSeP (Apache 2.0 by the InstanSeg README's claim only).

| Measure | InstanSeg | Reference |
|---|---|---|
| TNBC PQ, 50 images (in its training data) | 0.712 | WebGPU AIS pass 0.828, prompt fallback 0.796 |
| MoNuSeg test PQ, 14 images (not in its training data) | 0.663 | No fair PathoSAM number, it trained on MoNuSeg |
| Network of one 512 px tile on WebAssembly, M4, one thread | 689 ms | PathoSAM encode 5,300 to 5,900 ms |
| Same at the app's thread count (10 on the M4) | 226 ms | |
| Post-processing in the browser | Not built. About 65 ms in TorchScript on the CPU | |
| CI CPU runner | Not measured. No CI job runs the bench or provisions the weights | |

The bar, fixed before the full runs, was PQ 0.70 on both sets and the network under 1 s. TNBC passes, MoNuSeg test does not, and the speed bar passes on the M4 for the network alone.

StarDist `2D_versatile_he` was not run. It trained on MoNuSeg and TNBC per ADR 0042's matrix (model licensing policy, Rejected and kept as reference), so neither set here is held out for it, and its weights licence is still `TODO` there.

## Options considered

1. Ship InstanSeg now as the default auto tool without WebGPU. Its network is 8 to 25 times faster than the PathoSAM encode on WebAssembly, but 0.12 PQ below the WebGPU pass on TNBC and below the bar on MoNuSeg, and the post-processing does not exist in the browser yet.
2. Defer. Fast keeps no auto region model, InstanSeg is the named candidate, and a follow-up task ports the post-processing, runs CI and asks the owner whether 0.66 to 0.71 PQ is acceptable as a default.
3. Run the PathoSAM AIS pass on WebAssembly as the Fast auto tool. It keeps PQ 0.828 but takes several seconds per tile, which the task rules out.

## Decision

Option 2. The Fast region row of ADR 0361 stays empty, and InstanSeg `brightfield_nuclei` v0.1.1 is its candidate. It enters Fast when all of these hold.

1. Its post-processing runs in the browser, as TypeScript or a second small graph, and the exported path scores within 0.01 PQ of the TorchScript 0.712 on the same 50 TNBC images.
2. The whole path, network and post-processing, segments a 512 px tile in under 1 s on WebAssembly on the CI CPU runner at the thread count the app sets (`navigator.hardwareConcurrency` in `createOrtRuntime`).
3. The owner answers decision XXX (whether InstanSeg's accuracy is enough for a default without WebGPU), or a later model passes PQ 0.70 on a set it did not train on.

## Consequences

- AISEG-013 is done by this record. The follow-up task AISEG-021 (InstanSeg post-processing in the browser) carries rules 1 and 2 and a CI job that downloads the 15 MB zip by its checksum and runs `bench:instanseg`.
- `parfocal_ml.instanseg` scores the TorchScript model and exports the network to ONNX. `pnpm --filter @parfocal/viewer-engine bench:instanseg` times the network on WebAssembly. Its budget test covers the network alone, so a green run is not rule 2.
- The weights tests in `workers/ml/tests/test_instanseg.py` skip without the zip, and `test:accuracy` turns a skip into a failure, so that suite needs the zip in `~/.cache/parfocal/models/instanseg/v0.1.1`. Nothing in CI runs `test:accuracy` today.
- The licence row of ADR 0042's matrix for InstanSeg can now be filled from the zip: weights Apache-2.0, training sets as above, with CoNSeP still `unconfirmed`.

## References

- [InstanSeg result](../results/2026-11-16-instanseg-on-tnbc-and-wasm.md)
- POC doc 20 section 2.4 in [poc-reference.md](../project/poc-reference.md)
- [InstanSeg releases](https://github.com/instanseg/instanseg/releases), read on 2026-11-16
