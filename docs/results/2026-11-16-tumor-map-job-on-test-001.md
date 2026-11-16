# Result: the tumor map job on the whole of test_001, a CAMELYON16 test slide

- Date: 2026-11-16
- Backlog: AITUM-001 (tumor map job)
- Kind: ML evaluation
- Commit: the AITUM-001 commit on top of `2a265e8f` (`workers/ml/src/parfocal_ml/tumor_map.py`, `tumor_froc.py`, `workers/ml/spike/tumor_map_run.py`)
- Environment: Apple M4, macOS 15.8.1, MPS capped at 30% of the working set, shared with three other agents, the POC's server venv (Python 3.12.14, torch 2.14.0, MONAI 1.6.0, openslide-python 1.4.6, scikit-image 0.26.0, scipy 1.17.1)
- Data: `test_001.tif` and `test_001.xml` (CAMELYON16, CC0 per the bundle's `data_license.txt`), `tumor_009.tif` and the POC map `server/fixtures/tumor/tumor_009.npz`. Weights: MONAI `pathology_tumor_detection` 0.6.4 `models/model.pt`, SHA-256 `5a0d9b9e714e18a90c1f7f7d9c7e47f807c59f9f8c681b84865fae208fcbb4d6`, licence row in ADR 0351 (the v1 tumor model and its evaluation)

## Question

Does the new map job, run over the whole tissue mask of an unseen test slide and stored as a raster pyramid, score within the expected lesion-level FROC? The only published reference is the bundle's FROC of 0.72 over the 48 annotated test slides. No per-slide range exists anywhere in the repository or the bundle.

## Method

```
PYTHONPATH=workers/ml/src:packages/py-common/src <POC>/server/.venv/bin/python \
  workers/ml/spike/tumor_map_run.py <bundle>/models/model.pt \
  ~/.cache/parfocal/fixtures/test_001.tif out --xml ~/.cache/parfocal/fixtures/test_001.xml
```

1. Tissue mask from the level 6 thumbnail by HSV saturation above Otsu (floor 20), sampled at the centre of every 64 px cell.
2. Tiles of 32 by 32 cells that touch tissue. Each tile reads one 2,240 px level 0 region (224 px window, 32 px stride, 96 px margin, the POC's constants), runs the ResNet18 fully convolutionally to a 64 by 64 grid, averages 2 by 2 into 64 px cells and zeroes cells off tissue. One tile is in memory at a time.
3. Stored as `heatmap.bin` (gzip uint8, 0 to 255) and `heatmap.json` in the format the API's heatmap route already serves, plus `heatmap.1.bin` to `heatmap.3.bin`, each halving the previous one by the maximum of 2 by 2 cells until no side exceeds 256.
4. Every metric is computed on the decoded stored uint8 grid, not the float map.
5. FROC is a fresh port of MONAI's `LesionFROC`: NMS with box 48 cells and threshold 0.5, ground truth from the XML `Tumor` polygons minus the `None` ones rasterised to the cell grid, grown by 75 µm, holes filled, labelled with connectivity 2, regions whose major axis is below 275 µm left out as isolated tumor cells, and the challenge's rates of 0.25, 0.5, 1, 2, 4 and 8 false positives per slide. Run at the bundle's spacing of 0.243 µm/px and at the slide's own 0.226 µm/px.
6. Cross-checks: a bounded region of `tumor_009` against the POC's stored map, and the FROC port against MONAI's own `PathologyProbNMS`, `compute_fp_tp_probs`, `compute_froc_curve_data` and `compute_froc_score` on the same grid, plus five noisy copies of it (seed 20261116).

## Results

Map against the POC on `tumor_009`, cells 384 to 512 across and 2,304 to 2,432 down, 13 tiles:

| Cells on tissue in both | Pearson r | Mean absolute difference | Same side of 0.5 | Tissue cells agreeing |
|---:|---:|---:|---:|---:|
| 3,190 | 0.99999 | 0.0010 | 100% | 98.5% |

Whole `test_001` (86,016 by 89,600 px, grid 1,344 by 1,400 cells, 292,029 tissue cells):

| Tiles | Seconds | Seconds per tile | Stored bytes, base and three levels |
|---:|---:|---:|---|
| 837 | 454.0 | 0.54 | 98,767, 36,287, 13,720, 5,302 |

Lesion-level FROC, bundle spacing and slide spacing gave the same numbers:

| FROC | Sensitivity at every rate | Lesions after growing | Isolated, left out | Counted | Hit | Detections | False positives |
|---:|---|---:|---:|---:|---:|---:|---:|
| 1.000 | 1.000 | 5 | 2 | 3 | 3 | 74 | 28 |

The three counted lesions all peak at the stored maximum of 255, above the highest false positive at 0.992. MONAI's own functions gave FROC 1.000 with 3 counted lesions and 74 detections at both spacings. On the five noisy copies the port and MONAI agreed exactly: 0.1875, 0.2386, 0.1641, 0.2188 and 0.1750.

Cells, Dice at 64 px cells on tissue or tumour:

| Threshold | Dice | Sensitivity | Specificity |
|---:|---:|---:|---:|
| 0.5 | 0.908 | 0.847 | 0.998 |
| 0.7 | 0.873 | 0.781 | 0.999 |
| 0.9 | 0.787 | 0.650 | 1.000 |

Cell AUC 0.980 over 292,679 cells, 25,822 of them tumour.

## Interpretation

- The job reproduces the POC's map to within the uint8 step, so tiling, alignment and preprocessing are right. The 1.5% of tissue cells that differ come from the numpy Otsu mask against MONAI's `ForegroundMask`.
- On `test_001` the map finds all three counted lesions with higher confidence than any false alarm, so FROC is 1.0, above the bundle's 0.72. This is one slide with large deposits and only three counted lesions, so sensitivity moves in steps of a third and the number is not comparable with the 48-slide figure. It says the job works end to end on a test slide, not how good it is.
- 28 false positives above 0.5 on one slide is many. They only cost nothing here because the lesions all saturate. On slides with micrometastases they will pull FROC down, which a multi-slide run will show.
- The whole slide took 7.6 minutes on a shared MPS, inside the 40 minute limit. The POC took 393 s for 1,160 tiles of `tumor_009` on an idle machine.
- Max reduction for the pyramid keeps a single hot cell visible at overview, unlike the mean that `heatmap_export.halve` uses for imported heatmaps. A map of where tumour might be should not hide a small focus when zoomed out.

## Follow-ups

- TODO: the expected per-slide FROC range is undefined. MLEVAL-005 (tumor map evaluation) should set it over at least three test slides, one without metastases, as ADR 0351 says. Decision XXX asks how to judge AITUM-001 until then.
- TODO: wiring the job into the job system and an API route, and the server scorer that AITUM-004's "Map this view" panel waits for, are not built here.
- TODO: test slides other than `test_001` are not on the Mac.
