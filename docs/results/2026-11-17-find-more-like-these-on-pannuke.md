# Result: three exemplars ranking the auto region tool's nuclei by PathoSAM tokens reach precision at 10 of 0.61 for neoplastic and 0.58 for inflammatory on PanNuke, against 0.33 and 0.17 at random, and barely help connective, epithelial or dead

- Date: 2026-11-17
- Backlog: AISEG-023 (find more like these on typed PanNuke nuclei)
- Kind: spike
- Commit: the AISEG-023 commit that adds `parfocal_ml.typed_exemplars`, on top of fcf5d638
- Environment: Apple M4, 24 GB, macOS 15.8.1, Python 3.14.10, numpy 2.5.4, onnxruntime 1.31.1 on `CPUExecutionProvider` with 4 threads under `nice -n 15`, Node 26.13.1. Other agents shared the machine, so times are indicative only
- Data: PanNuke fold 1 (Warwick, CC BY-NC-SA 4.0, public, no PHI) from `parfocal_ml.datasets`, kept in the dataset cache and never committed. 448 tiles drawn with seed 20261117 from all 19 tissues (Breast 140, Colon 75, Esophagus 33, Bile-duct 30, Cervix 25, Adrenal gland 22, 13 others 123). Graphs `pathosam.encoder_uint8.onnx` and `pathosam.ais_decoder_int8_weights.onnx`, the auto region tool's defaults

## Question

Decision 130 (a typed fixture run for "find more like these"), option B, and ADR 0359 (find more like these is a no-go on PathoSAM tokens) ask whether the gesture can come back as ranking only: the auto region tool finds the nuclei, the user picks a few of one kind, and the rest are ranked by similarity to them. AISEG-014 (find more like these) could only test a size proxy on TNBC, which has no cell types. Does the token ranking pick nuclei of the exemplars' kind?

## Method

```
pnpm --filter @parfocal/ml bench:typed-exemplars
```

All settings were fixed before the full run and not retuned: 448 tiles, 3 exemplars, 20 draws per kind, match IoU 0.5, K of 10 and 50.

1. Tiles. The 448 tiles (256 px at 0.25 µm/px) are shuffled with the seed and laid out 2 by 2 into 112 mosaics of 512 px, so the encoder sees the same scale as the TNBC bench in AISEG-014. Mosaic edges are not natural tissue.
2. Nuclei. Each mosaic is encoded once, the AIS decoder runs on the embedding, and `apps/web/region-bench/ais-rings.ts` turns the maps into rings with `aisInstances`, the function the auto region tool runs in the browser. Each ring is filled and matched to the PanNuke instance it overlaps most. At IoU 0.5 or more it takes that instance's type, otherwise it is "unmatched" and stays in the pool as a negative. A second source, "truth", uses PanNuke's own masks and types, which separates detection errors from ranking.
3. Vectors. As in AISEG-014, a nucleus vector is the coverage-weighted mean of its unit-normalised encoder tokens (64 by 64, 8 px each) under its mask, and the prototype is the normalised mean of the exemplar vectors.
4. Draws. Per kind, a draw picks one mosaic with at least 3 nuclei of that kind and 3 of them as exemplars, as a user would pick them in one view. Every other nucleus of all 112 mosaics is ranked by cosine to the prototype. Unlike AISEG-014, which ranked within one image, this pools across images, as a region or slide search would.
5. Pools. "All" ranks every other nucleus. "Other mosaics" drops the exemplars' own mosaic, because PanNuke types cluster by tile and tissue, and a hit from the same tile is weaker evidence of type selectivity.
6. Baselines. Random is the same pool shuffled with the seed, and prevalence is its exact expectation. Colour ranks by distance to the exemplars' mean RGB.

## Results

The pool holds 10,058 detected nuclei: 3,290 neoplastic, 1,742 inflammatory, 2,049 connective, 70 dead, 1,156 epithelial and 1,751 unmatched. PanNuke's own masks give 10,376 nuclei. Precision is the share of the top K whose type is the exemplars' kind, as a mean over 20 draws.

Detected nuclei, the auto region tool's output:

| Kind | Positives | Pool | Prevalence | Tokens P@10 | Tokens P@50 | Colour P@10 | Colour P@50 | Random P@10 | Random P@50 |
|---|---|---|---|---|---|---|---|---|---|
| neoplastic | 3,290 | all | 0.327 | 0.610 | 0.574 | 0.440 | 0.423 | 0.340 | 0.334 |
| neoplastic | | other mosaics | 0.327 | 0.595 | 0.563 | 0.440 | 0.406 | 0.295 | 0.323 |
| inflammatory | 1,742 | all | 0.173 | 0.575 | 0.536 | 0.325 | 0.258 | 0.220 | 0.186 |
| inflammatory | | other mosaics | 0.173 | 0.570 | 0.533 | 0.290 | 0.245 | 0.175 | 0.162 |
| connective | 2,049 | all | 0.204 | 0.385 | 0.291 | 0.290 | 0.240 | 0.250 | 0.221 |
| connective | | other mosaics | 0.204 | 0.355 | 0.287 | 0.290 | 0.238 | 0.190 | 0.209 |
| epithelial | 1,156 | all | 0.115 | 0.250 | 0.189 | 0.240 | 0.216 | 0.120 | 0.122 |
| epithelial | | other mosaics | 0.114 | 0.200 | 0.163 | 0.200 | 0.188 | 0.090 | 0.104 |
| dead | 70 | all | 0.007 | 0.385 | 0.170 | 0.050 | 0.038 | 0.000 | 0.007 |
| dead | | other mosaics | 0.004 | 0.030 | 0.027 | 0.015 | 0.012 | 0.005 | 0.009 |

PanNuke's own masks and types:

| Kind | Positives | Pool | Prevalence | Tokens P@10 | Tokens P@50 | Colour P@10 | Colour P@50 | Random P@10 | Random P@50 |
|---|---|---|---|---|---|---|---|---|---|
| neoplastic | 4,092 | all | 0.394 | 0.625 | 0.589 | 0.545 | 0.500 | 0.345 | 0.374 |
| neoplastic | | other mosaics | 0.394 | 0.610 | 0.571 | 0.515 | 0.469 | 0.420 | 0.424 |
| inflammatory | 2,047 | all | 0.197 | 0.540 | 0.543 | 0.300 | 0.278 | 0.160 | 0.200 |
| inflammatory | | other mosaics | 0.197 | 0.525 | 0.542 | 0.290 | 0.261 | 0.200 | 0.206 |
| connective | 2,727 | all | 0.263 | 0.385 | 0.352 | 0.425 | 0.332 | 0.280 | 0.272 |
| connective | | other mosaics | 0.263 | 0.370 | 0.353 | 0.385 | 0.317 | 0.285 | 0.270 |
| epithelial | 1,406 | all | 0.135 | 0.310 | 0.250 | 0.330 | 0.253 | 0.155 | 0.149 |
| epithelial | | other mosaics | 0.135 | 0.210 | 0.208 | 0.260 | 0.223 | 0.120 | 0.143 |
| dead | 104 | all | 0.010 | 0.265 | 0.140 | 0.030 | 0.028 | 0.010 | 0.007 |
| dead | | other mosaics | 0.007 | 0.020 | 0.019 | 0.005 | 0.006 | 0.005 | 0.005 |

Share of the token ranking's top 10 and top 50 that comes from the exemplars' own mosaic, detected nuclei: neoplastic 0.15 and 0.07, inflammatory 0.14 and 0.05, connective 0.06 and 0.04, epithelial 0.11 and 0.06, dead 0.55 and 0.26.

Median encode 2,914 ms and AIS decode 2,524 ms per mosaic, whole run 724 s including reading the fold.

## Interpretation

- Neoplastic and inflammatory rank well. Token precision at 10 is 1.9 and 3.3 times prevalence on detected nuclei, it holds outside the exemplars' own mosaic (0.595 and 0.570), and it beats colour by 0.15 to 0.28. The tokens carry more than stain colour for these two kinds. Size still may explain part of inflammatory, since lymphocytes are small and AISEG-014 showed the tokens track size. That is not measured separately here.
- Connective and epithelial barely rank. Precision at 50 is within 0.09 of prevalence, colour at 50 comes within 0.06 of the tokens on detected nuclei and beats them at 10 on PanNuke's own masks, so a user would see mostly other kinds.
- Dead is too few to judge. Draws can only start from the few mosaics with three or more of the 70 detected dead nuclei, and the apparent 0.385 at 10 comes from the exemplars' own mosaic (0.55 of the top 10). Outside it, precision at 10 is 0.03.
- Detection costs little. The detected and truth tables agree within 0.04 for the two kinds that work, so the unmatched detections (17% of the pool) do not drown the ranking.
- The whole pool is 112 mosaics of one fold. The draws are 20 per kind, so the means move by a few hundredths between seeds. This is not tested.
- This measures ranking only, not the seed-based search that ADR 0359 rejected. It says the gesture could work as a filter over the auto region tool's nuclei for kinds with a distinct look, not as a general cell-kind finder. A trained typer, such as the HoVer-NeXt PanNuke typer from OPS-026 (HoVer-NeXt typer ONNX export), types 84.9% of fold 3 nuclei right and is the stronger tool where its kinds suffice.

## Follow-ups

- ADR 0359 (find more like these is a no-go on PathoSAM tokens) stays a no-go for search. Whether a ranking-only gesture ships is a product choice and is not decided here. TODO: decide in `docs/decisions.md`.
- TODO: a size-matched control for inflammatory would show how much of its lift is size.
