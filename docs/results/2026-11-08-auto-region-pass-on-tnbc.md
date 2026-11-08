# Result: the auto region pass scores PQ 0.828 on all 50 TNBC images and a warm four tile pass takes 12.2 s on WebGPU

- Date: 2026-11-08
- Backlog: AISEG-010 (auto region tool)
- Kind: ML evaluation
- Commit: d6dc3a0b plus the AISEG-010 change on its branch
- Environment: Apple M4, 24 GB, macOS 15.8.1, Python 3.14.7, numpy 2.5.4, onnxruntime 1.31.1 on `CPUExecutionProvider`, Node 26.13.0, Google Chrome headless through Playwright with `--enable-unsafe-webgpu`. Two other agents shared the machine, so times are indicative only
- Data: all 50 TNBC v1.1 images (512 by 512, Zenodo 1175282, CC BY 4.0, public, no PHI) from `parfocal_ml.datasets`, 4,053 nuclei after vague ones are dropped. The browser run uses the first 4 patches of the smart select smoke fixture laid out 2 by 2. Graphs from `python -m parfocal_ml.sam_onnx.export` in `~/.cache/parfocal/models/onnx`

## Question

Does the auto region tool's TypeScript AIS post-processing reach the recorded browser baseline, `pathosam-ais-browser` PQ 0.8235 on TNBC from the [geometric scorer result](2026-10-18-geometric-scorer-reproduction.md) (POC doc 26), within 0.01 PQ? The tolerance was fixed before the run and matches MLEVAL-003 (interactive protocol). How long does a region pass take in the browser? TEST-006 (performance budget suite) had no budget for it, so this run sets the baseline.

## Method

```
pnpm --filter @parfocal/ml bench:ais-region -- --encoder ENCODER --ais-decoder AIS_DECODER
pnpm --filter @parfocal/ml test:weights
pnpm --filter @parfocal/web bench:region
```

`parfocal_ml.ais_region` encodes each image at the 1024 px encoder input with no resampling (`sam_contract.pixel_values`), runs the AIS decoder, writes the three 512 by 512 maps, runs `apps/web/region-bench/ais-rings.ts` under Node on them, and scores the rings with `parfocal_ml.scoring`. The rings come from `aisInstances`, the same function the region pass calls in the browser. Outline time is that function alone, per image, in Node.

The browser spec runs the real inference worker and `runRegionPass` over a 768 by 768 px region at 0.25 µm/px (192 by 192 µm), which is four 512 px tiles with a 64 px halo. It runs the same pass three times. The pass time covers patch reads from memory, `samPixels`, encode, AIS decode, the outlines and the centroid filter. The first pass includes the AIS session's creation.

The CI budget test times `aisInstances` on a synthetic 512 px map of 169 discs, fastest of three, in three separate runs.

## Results

All 50 TNBC images, pooled over nuclei:

| Encoder | AIS decoder | Variant | Predicted | Recall | Precision | F1 | PQ | SQ | AJI | Within 0.01 of 0.8235 |
|---|---|---|---|---|---|---|---|---|---|---|
| uint8 | int8 weight-only | WebAssembly, gated | 4,036 | 0.9511 | 0.9552 | 0.9531 | 0.8284 | 0.8691 | 0.8429 | yes |
| uint8 | fp32 | the POC's pair | 4,037 | 0.9511 | 0.9549 | 0.9530 | 0.8282 | 0.8690 | 0.8428 | yes |
| 4-bit | int8 weight-only | WebGPU | 4,028 | 0.9499 | 0.9558 | 0.9529 | 0.8243 | 0.8651 | 0.8371 | yes |

Medians per image on the onnxruntime CPU in the same runs, in ms:

| Encoder | AIS decoder | Encode | AIS decode | Outlines in Node (max) |
|---|---|---|---|---|
| uint8 | int8 weight-only | 2,815 | 2,594 | 203 (444) |
| uint8 | fp32 | 2,915 | 2,437 | 76 (269) |
| 4-bit | int8 weight-only | 3,027 | 2,647 | 108 (159) |

Browser region pass, WebGPU (no fallback), four tiles, 232 nuclei found on every pass:

| Run | Pass 1 (ms) | Pass 2 (ms) | Pass 3 (ms) | Encode per tile (ms) | AIS decode per tile (ms) |
|---|---|---|---|---|---|
| 1 | 12,672 | 12,336 | 12,303 | 1,385 to 1,508 | 1,420 to 1,895 |
| 2 | 12,200 | 12,229 | 12,364 | 1,342 to 1,487 | 1,363 to 1,727 |

Outlines of one synthetic 512 px tile of 169 nuclei in Node, fastest of three: 132.9, 137.6 and 122.1 ms in three runs.

## Interpretation

- The gated pair is 0.0049 PQ above the baseline. All three pairs are within the tolerance, and the 4-bit encoder of the WebGPU variant gives 0.004 PQ less than the uint8 one, in line with its larger embedding error in the [export result](2026-11-06-pathosam-onnx-export.md).
- The int8 weight-only AIS decoder costs nothing in PQ against fp32 (0.8284 against 0.8282).
- PQ above the POC's 0.8235 may come from TNBC v1.1, which has three nuclei fewer than the POC's copy, or from the two outline tracers. That is an assumption, not measured.
- About 95 percent of the browser pass is encode and AIS decode, about 2.9 s of the 3.06 s each tile takes on WebGPU (12,229 ms / 4 tiles). A tile's core is 384 px at 0.25 µm/px, so 96 µm on a side. A 1 mm² square is 1,000 / 96 = 10.4 cores on a side, so about 10.4² = 108 tiles by area and 11 × 11 = 121 whole tiles. At 3.06 s per tile that is 108 × 3.06 = 331 s, about 5.5 minutes, or 121 × 3.06 = 370 s, about 6.2 minutes with whole tiles. The outline times in Node vary with machine load, 76 to 203 ms median for maps of the same kind, so they are CPU contention, not a property of the graph.
- `aiseg.region-pass-ms` (manual, baseline 12,229 ms, the fastest warm pass of both runs as ADR 0154 asks, limit 24,458 at twice that) and `aiseg.region-outline-ms` (CI, baseline 122 ms, limit 360) are new in `perf-budgets.json`, and both runs passed them.

## Follow-ups

- ADR XXXX (auto region pass) records the tiling, the gate and the two budgets.
- TODO: the WebAssembly fallback pass time. The [provider result](2026-11-06-sam-variants-per-provider.md) suggests about 11 s per tile.
- TODO: the drag, click and detect-in-selection gestures in the annotate workspace use `runRegionPass`. Their UI is the next step of AISEG-010.
