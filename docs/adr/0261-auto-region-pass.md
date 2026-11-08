# 0261. The auto region pass runs the AIS decoder per 512 px tile with a 64 px halo, keeps nuclei by centroid and is gated on TNBC through the TypeScript post-processing

- Date: 2026-11-08
- Status: Accepted
- Deciders: Yurii Fedas (to confirm), proposed by the agent building AISEG-010 (auto region tool)
- Backlog: AISEG-010 (auto region tool). Builds on [ADR 0246](0246-pathosam-onnx-export-contract.md) (the PathoSAM ONNX export contract), [ADR 0248](0248-detector-runner-stitches-full-resolution-ais-maps.md) (the server detector stitches full AIS maps), [ADR 0250](0250-sam-graph-per-execution-provider.md) (each execution provider loads its own PathoSAM graphs), [ADR 0253](0253-sam-inference-worker.md) (one inference worker) and [ADR 0154](0154-performance-budget-file-and-regression-rule.md) (the performance budget file)

## Context

The auto region tool turns a dragged rectangle, a click or one closed shape into nucleus outlines. POC doc 26 (held-out benchmarks) moved the POC's region pass to the PathoSAM automatic instance segmentation (AIS) decoder in the browser: one decode per 512 px tile on the encoder's embedding, then a marker watershed on the foreground, centre distance and boundary distance maps and sub-pixel contours. It scored PQ 0.824 on TNBC, recorded as `pathosam-ais-browser` PQ 0.8235 in the [geometric scorer result](../results/2026-10-18-geometric-scorer-reproduction.md). The inference worker already has `segmentAll`. Three things had no answer yet: how a region bigger than one patch is cut into tiles without counting a nucleus twice, how the gate scores the code the browser ships, and which budget the region pass must meet, since the TEST-006 (performance budget suite) file had no entry for it.

## Options considered

Tiles and seams:

1. Tiles that touch with no overlap. A nucleus on a seam is cut in two.
2. Overlapping tiles, with duplicates merged by IoU across tiles. It needs a second pass over neighbours and a merge threshold to tune.
3. Overlapping tiles whose cores partition the region. Each tile is read with a 64 px halo, as ADR 0248 does on the server, and a nucleus is kept only by the tile whose core holds its centroid.

The gate:

1. Port the post-processing to Python and score that. The gate would then test a copy, not the code users run.
2. Run the browser graphs in Chrome on all 50 TNBC images. The scorer is Python, so the rings would still have to be carried out of the browser, and a 50 image browser run is slow on WebAssembly.
3. Make the maps with onnxruntime on the CPU from the same graph files, run the TypeScript post-processing on them under Node, and score its rings with `parfocal_ml.scoring`.

## Decision

Option 3 for tiles and option 3 for the gate.

- `planRegionTiles` steps by the patch width minus two halos at the nuclei preset, so 384 px of core per 512 px patch. A click is one tile centred on the cursor that keeps the whole patch. Detect in selection tiles the shape's bounding box and also keeps only nuclei whose centroid is inside the shape. The pass checks its abort signal between tiles and drops each embedding after its `segmentAll`.
- `aisInstances` in `apps/web/src/aiseg/ais-instances.ts` follows the POC's constants: Gaussian smoothing with mirrored edges (sigma 1 on the foreground, 1.6 on both distance maps), all three thresholds at 0.5, four-connected markers where both distances are under the threshold, a heap-ordered watershed on the boundary map inside the foreground, a minimum area of 20 map pixels, and each instance's own mask blurred with sigma 1, traced at 0.5 and simplified at 0.25 px.
- `python -m parfocal_ml.ais_region` and the `weights` test in `workers/ml/tests/test_ais_region.py` encode every TNBC image straight at the 1024 px input, as doc 26 did, run the AIS graph, write the maps, call `apps/web/region-bench/ais-rings.ts` under Node and score the rings. The gated pair is the one the WebAssembly variant loads, the uint8 encoder and the int8 weight-only AIS decoder. It must be within 0.01 PQ of 0.8235, the tolerance MLEVAL-003 (interactive protocol) and AISEG-016 (prompt-pass fallback) use. TNBC v1.1 has three nuclei fewer than the POC's copy, so an exact match is not expected. The PQ gate is a `weights` test: it is deselected by default, it does not run in CI because CI has no model weights, and it runs by hand through `pnpm --filter @parfocal/ml test:weights`.
- Two budgets join `perf-budgets.json`. `aiseg.region-outline-ms` is a CI time budget for the post-processing of one 512 px tile of 169 synthetic nuclei, checked in `apps/web/test/aiseg-ais-instances.test.ts`. `aiseg.region-pass-ms` is a manual budget for a warm four tile pass on the real graphs in Chrome, checked by `pnpm --filter @parfocal/web bench:region`, because CI has no model weights.

## Consequences

- No nucleus is counted twice and none is lost on a seam unless it is wider than the 64 px halo, which at 0.25 µm/px is 16 µm.
- The post-processing runs on the calling thread, about 120 to 230 ms per tile on an Apple M4. That blocks the main thread once per tile. TODO: move it into a worker if the tool feels stuck during a pass.
- The gate needs Node next to Python. The non-weights test skips without it.
- The WebGPU variant uses the 4-bit encoder, whose PQ is measured in the [result](../results/2026-11-08-auto-region-pass-on-tnbc.md) but not gated.
