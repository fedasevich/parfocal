# Result: Interactive protocol reproduces POC doc 26 on TNBC

- Date: 2026-11-06
- Backlog: MLEVAL-003 (interactive protocol)
- Kind: ML evaluation
- Commit: d1de8e27 plus the MLEVAL-003 harness on its branch
- Environment: MacBook with Apple M4 and 24 GB, macOS 15.8.1, Python 3.14.7, numpy 2.5.4, onnxruntime 1.31.1 on `CPUExecutionProvider`, one Python process. Two other agents shared the machine, so times are indicative only
- Data: all 50 TNBC images (512 by 512 pixels, Zenodo 1175282, public, no PHI) from `parfocal_ml.datasets`, 3,466 prompted nuclei. The graphs are `pathosam.encoder_uint8.onnx` and `pathosam.decoder.onnx` from `python -m parfocal_ml.sam_onnx.export` in `~/.cache/parfocal/models/onnx`

## Question

Does the parfocal harness reproduce the held-out click and box numbers of POC doc 26 (held-out benchmarks) for PathoSAM with contour outlines on TNBC, within a tolerance of 0.01 mean IoU per prompt? Doc 26 rounds them to 0.851 (realistic and ideal click), 0.863 (exact box), 0.817 (loose box) and 0.884 (three clicks). The baseline is the POC's own per-nucleus score file for that run, `server/fixtures/tnbc/results/pathosam-uint8-contour.scores.jsonl`, whose means are given to four decimals below. That run used the uint8 encoder on onnxruntime-node CPU, the best of the four masks and mask feedback during refinement. The tolerance was fixed before the run. The standard error of a 3,466-nucleus mean is about 0.002.

## Method

```
pnpm --filter @parfocal/ml bench:interactive
pnpm --filter @parfocal/ml test:weights
```

`parfocal_ml.interactive` is fresh code following the rules of doc 26 and the POC's `fixture.py`, `bench-accuracy.mjs` and `score_accuracy.py`.

- Nuclei of at least 20 pixels and at least 3 pixels from the image edge are prompted. Each image seeds its own generator with the CRC-32 of its name.
- Ideal click: the deepest interior point. Realistic click: the centroid plus a Gaussian miss with sigma 0.35 of the equivalent radius, redrawn up to 50 times until it lands inside, else the ideal click. Exact box: the bounding box. Loose box: each edge moved outward by N(0.05, 0.10) of the side, clamped as the POC did. On the first six images every prompt equals the POC fixture's to the pixel, which a unit test checks.
- One encode per image. Each prompt decodes once and keeps the candidate with the highest predicted IoU out of all four. The 256 by 256 low-resolution logits are resampled bilinearly at pixel centres to 512 by 512. The component under the first positive click (the largest one for a box) is traced by marching squares on the logit field at level 0 and simplified at 0.2 px.
- Refinement on every nucleus whose id is a multiple of 4: start from the realistic click, then add a corrective click at the deepest error pixel (positive on a miss, negative on an extra) and feed the previous low-resolution logits as `mask_input`. Steps 2 and 3 give doc 26's "three clicks" row.
- The same trajectory continues for NoC: until IoU 0.90 or 20 clicks, and a nucleus that never reaches the target counts as 20.
- Scoring is the POC's per-nucleus geometric scorer: the ring is filled by centre sampling on a 4x grid over the nucleus crop (pixel resolution above 128 by 128), against the label as squares.

The weights test runs the first two images and compares each mode with the POC's means on the same nuclei, at the same tolerance.

## Results

Mean IoU per nucleus on all 50 TNBC images.

| Prompt | Nuclei | POC doc 26 (rounded) | POC run (four decimals) | Parfocal harness | Standard error | Difference | Within 0.01 |
|---|---|---|---|---|---|---|---|
| Ideal click | 3,466 | 0.851 | 0.8514 | 0.8529 | 0.0018 | +0.0015 | yes |
| Realistic click | 3,466 | 0.851 | 0.8514 | 0.8522 | 0.0019 | +0.0008 | yes |
| Exact box | 3,466 | 0.863 | 0.8632 | 0.8632 | 0.0011 | 0.0000 | yes |
| Loose box | 3,466 | 0.817 | 0.8167 | 0.8169 | 0.0015 | +0.0002 | yes |
| Two clicks | 856 (POC 858) | not given | 0.8737 | 0.8745 | 0.0029 | +0.0008 | yes |
| Three clicks | 856 (POC 858) | 0.884 | 0.8842 | 0.8806 | 0.0025 | -0.0036 | yes |

Share of realistic clicks at IoU 0.75 or better: 88.95% here and 88.86% in the POC run on TNBC. Doc 26's 53.3% is over all its sets.

New in this harness, with no doc 26 number to compare, on the 856 refined nuclei and a cap of 20 clicks:

| Metric | Mean clicks | Never reached in 20 |
|---|---|---|
| NoC@85 | 3.098 | 3.97% |
| NoC@90 | 7.563 | 18.57% |

The run took 881 s for 50 encodes and 20,288 decodes. Median encode 2,165 ms, median decode 21.1 ms on the CPU.

On the first two images, nucleus by nucleus against the POC run, the mean difference was within 0.002 for every single prompt and at most 2 of 192 nuclei differed by more than 0.05.

## Interpretation

The harness reproduces doc 26 on TNBC: every prompt lands within 0.004 of the POC run, well inside the tolerance of 0.01, and five of six within one standard error. The largest gap, three clicks at 0.0036 below, comes from the refinement path, where a small change in one ring moves the next click. The corrective click is chosen from the ring filled at pixel resolution by centre sampling, while the POC also painted the ring's edge pixels. That is an assumption about the cause, not a measured one. The two missing refined nuclei come from 2 of the 50 images whose labels differ from the POC fixture's.

This replaces the AISEG-005 (smart select tool) smoke as the accuracy baseline for prompts. The smoke's 0.91 to 0.93 scored pixel masks at 1024 and is not comparable.

NoC@90 is high because many TNBC nuclei never reach 0.90 against labels traced at pixel resolution. Doc 26 gives 0.897 for the ground truth itself traced through pixel centres.

## Follow-ups

- CryoNuSeg and NuInsSeg, doc 26's other held-out sets, were not run, to keep this run to the TNBC set on a shared machine. Both have loaders in `parfocal_ml.datasets`, but the harness does not yet skip NuInsSeg's vague areas or split CryoNuSeg's reused ids as doc 26 did. `TODO` when MLEVAL needs the held-out mean.
- The fp32 encoder can be run with `--encoder pathosam.encoder.onnx`. It was not measured here.
