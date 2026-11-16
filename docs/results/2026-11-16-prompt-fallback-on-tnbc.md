# Result: the prompt-pass fallback scores PQ 0.796 on all 50 TNBC images, 0.033 above the POC's stain-seed row

- Date: 2026-11-16
- Backlog: AISEG-016 (prompt-pass fallback for the auto region tool)
- Kind: ML evaluation
- Commit: 4e17034a
- Environment: Apple M4, 24 GB, macOS 15.8.1, Python 3.14.10, numpy 2.5.4, onnxruntime 1.31.1 on `CPUExecutionProvider` with 4 threads, Node 26. Three other agents shared the machine and the five-image runs overlapped a typecheck, so times are indicative only
- Data: all 50 TNBC v1.1 images (512 by 512, Zenodo 1175282, CC BY 4.0, public, no PHI) from `parfocal_ml.datasets`, 4,053 nuclei after vague ones are dropped. Graphs `pathosam.encoder_uint8.onnx` and `pathosam.decoder.onnx` from `~/.cache/parfocal/models/onnx`

## Question

Is the prompt-pass fallback, which runs when the AIS decoder cannot load, within 0.01 PQ of the POC's stain-seed row on TNBC? The row is `pathosam-auto-fast` (PathoSAM prompted at stain seeds, fast quality), pooled PQ 0.7629 over all 50 TNBC images, as our scorer reproduced it from the POC's stored predictions in the [geometric scorer result](2026-10-18-geometric-scorer-reproduction.md). POC doc 26 lists the same run as 0.752, which is its mean over images, not pooled. Its "contour outlines, stain seeds" row (0.514) is on `dev`, which mixes TNBC, CryoNuSeg and NuInsSeg, so no TNBC number with contour outlines exists. The gate is one-sided, like the AIS gate in ADR 0261 (auto region pass), because the contour tracer was worth +0.015 PQ on `dev` and the fallback may beat the old outlines. What does best quality (residual pass and five-prompt ensemble) add?

## Method

```
pnpm --filter @parfocal/ml bench:prompt-region -- --threads 4
pnpm --filter @parfocal/ml bench:prompt-region -- --images 5 --quality fast --threads 4
pnpm --filter @parfocal/ml bench:prompt-region -- --images 5 --quality best --threads 4
```

The `weights` test in `workers/ml/tests/test_prompt_region.py`, run by `pnpm --filter @parfocal/ml test:weights`, wraps the same `run` with the same graphs and gate. It was not run on its own for this result, because the bench above already covers it and the machine was shared.

`parfocal_ml.prompt_region` encodes each image at the 1024 px encoder input, then drives `apps/web/region-bench/prompt-rings.ts` under Node over a line protocol. The Node side runs `promptFallback`, the same function the region pass calls in the browser, with `promptPassOptionsFor(0.25, quality)`. Each `sam.prompt` call goes back to Python, which runs the full single-prompt decoder with `orig_im_size` 1024 and returns the best mask of all candidates, as the browser's full decode path does. The browser may use the embedding-window decoder instead (ADR 0311, the click decoder runs on a window of the embedding), so this run covers the full-decoder path only. So stain seeding, acceptance, the ensemble, duplicate removal, `bestMask`, `fittedLogits`, contour tracing and simplification are all the shipped TypeScript. Each image is one 512 px tile. Rings are scored with `parfocal_ml.scoring`, pooled over nuclei.

## Results

All 50 TNBC images, fast quality:

| Run | Predicted | Recall | Precision | F1 | PQ | SQ | AJI | Within 0.01 of 0.7629 |
|---|---|---|---|---|---|---|---|---|
| prompt fallback, fast | 3,916 | 0.9181 | 0.9502 | 0.9339 | 0.7959 | 0.8523 | 0.7966 | yes |

18,352 decodes in all, median 387 per image. Median encode 2,847 ms, median decode 28.1 ms, median pass per image in Node including the decode round trips 17,431 ms. The whole run took 1,191.5 s.

First 5 TNBC images, 377 nuclei:

| Quality | Predicted | Recall | Precision | F1 | PQ | SQ | AJI | Decodes | Median pass (ms) |
|---|---|---|---|---|---|---|---|---|---|
| fast | 365 | 0.9655 | 0.9973 | 0.9811 | 0.8605 | 0.8771 | 0.8789 | 1,726 | 41,757 |
| best | 369 | 0.9761 | 0.9973 | 0.9866 | 0.8657 | 0.8774 | 0.8874 | 6,370 | 104,667 |

## Interpretation

- The fallback is 0.033 PQ above the POC's stain-seed row, with F1 0.934 against 0.922 and AJI 0.797 against 0.777 for the POC's stored predictions. The contour outlines are the likely cause, as on `dev`. That is an assumption, not measured separately.
- Best quality finds 4 more of 377 nuclei and adds 0.005 PQ for 3.7 times the decodes. That matches POC doc 15, where the ensemble moved PQ by 0.002 and the residual pass bought completeness.
- Five-image pass times are slower than the 50-image median because the runs overlapped a typecheck.
- The 96 px tile overlap is met by the shared tile grid. The fallback runs on the AIS tiles, whose 64 px halo gives neighbours 128 px of overlap at 512 px patches and 126 px at 256 px patches. The centroid-in-core rule keeps each nucleus once, and the largest accepted nucleus, radius 12 µm, is 48 px at 0.25 µm/px, so it fits inside the halo. Unit tests check both.

## Follow-ups

- The auto layer still asks for fast quality, so best quality is not reachable from the screen yet.
- Decodes still run one prompt at a time through `sam.prompt`. A batched decoder graph in the worker would cut the round trips.
