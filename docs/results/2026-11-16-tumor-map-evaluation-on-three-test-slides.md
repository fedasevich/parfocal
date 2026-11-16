# Result: the tumor map evaluation on three annotated CAMELYON16 test slides and one normal slide

- Date: 2026-11-16
- Backlog: MLEVAL-005 (tumor map evaluation)
- Kind: ML evaluation
- Commit: the MLEVAL-005 commit on top of `9beb891f` (`workers/ml/src/parfocal_ml/tumor_evaluation.py`, `workers/ml/spike/tumor_evaluation_run.py`)
- Environment: Apple M4, macOS 15.8.1, MPS capped at 30% of the working set, shared with three other agents, the POC's server venv (Python 3.12.14, torch 2.14.0, MONAI 1.6.0, openslide-python 1.4.6)
- Data: CAMELYON16 test slides `test_001` (macro), `test_065` and `test_013` (micro only) with their XML outlines, and `test_062` (normal), CC0 per the bundle's `data_license.txt`. Classes and centres are from the bucket's `evaluation/reference.csv`. Every file matched the bucket's `checksums.md5` before its SHA-256 went into `fixtures.json` (group `tumor-eval`). Weights: MONAI `pathology_tumor_detection` 0.6.4 `models/model.pt`, SHA-256 `5a0d9b9e714e18a90c1f7f7d9c7e47f807c59f9f8c681b84865fae208fcbb4d6`

## Question

What lesion-level FROC and cell Dice does the v1 tumor map reach over more than one test slide, including slides with only small metastases and one without any? This is the evidence decision 127 (what FROC counts as the expected range for the tumor map job) asks for, and the reference the promotion gate of ADR 0322 (the promotion gate compares with a reference within a tolerance) was waiting for.

## Method

```
pnpm fixtures tumor-eval
PYTHONPATH=workers/ml/spike/python312:workers/ml/src:packages/py-common/src <POC>/server/.venv/bin/python \
  workers/ml/spike/tumor_evaluation_run.py <bundle>/models/model.pt ~/.cache/parfocal/tumor-maps \
  ~/.cache/parfocal/fixtures/test_{001,065,013,062}.tif --monai
```

1. Each slide is mapped by `tumor_map_run.py` in its own process, one slide at a time, with the job and constants of AITUM-001 (tumor map job). The stored uint8 grid is cached as `<slide>/stored.npy`, so `python -m parfocal_ml.tumor_evaluation ~/.cache/parfocal/tumor-maps ~/.cache/parfocal/fixtures` recomputes every number below without the model or the slides.
2. `parfocal_ml.tumor_evaluation` scores each decoded grid with the FROC port of AITUM-001 at the bundle's 0.243 µm/px, Dice at 0.5 on 64 px cells, and AITUM-003's `find_tumor_areas` and `evaluate_areas` for size error and stray areas.
3. Pooled FROC is the challenge's: all detections of the annotated slides on one curve, false positives divided by the number of annotated slides. The normal slide only adds a false alarm count. Pooled Dice sums cells over the annotated slides.
4. Cross-check: MONAI's own `PathologyProbNMS`, `compute_fp_tp_probs`, `compute_froc_curve_data` and `compute_froc_score` on the same three grids with `num_images=3`.
5. Slide choice: the smallest annotated micro slides whose outlines keep at least one lesion after the isolated tumor cell cut, `test_065` (centre 1, 0.45 GB) and `test_013` (centre 0, 1.21 GB), and the smallest normal slide, `test_062` (centre 1, 0.48 GB). `test_001` is centre 1.

## Results

Pooled over the three annotated slides:

| Measure | Value |
|---|---:|
| FROC | 0.722 |
| FROC by MONAI's functions | 0.722 |
| Dice at 0.5 | 0.899 |
| Mean Dice per slide | 0.649 |
| Lesions counted | 6 |
| False positives on annotated slides | 66 |
| False positives on the normal slide | 26 |

Sensitivity at the challenge's false positives per slide:

| 0.25 | 0.5 | 1 | 2 | 4 | 8 |
|---:|---:|---:|---:|---:|---:|
| 0.500 | 0.667 | 0.667 | 0.833 | 0.833 | 0.833 |

Per slide:

| Slide | Class | FROC | Lesions after growing | Isolated, left out | Counted | Hit | Lowest hit | Detections | False positives | Highest false positive | Dice | Cell sensitivity |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| test_001 | macro | 1.000 | 5 | 2 | 3 | 3 | 1.000 | 74 | 28 | 0.992 | 0.908 | 0.847 |
| test_065 | micro | 0.500 | 3 | 1 | 2 | 2 | 0.780 | 34 | 30 | 0.969 | 0.613 | 0.734 |
| test_013 | micro | 0.500 | 2 | 1 | 1 | 1 | 0.965 | 10 | 8 | 1.000 | 0.424 | 0.536 |
| test_062 | normal | | 0 | 0 | 0 | 0 | | 26 | 26 | 0.980 | | |

Run cost, all on the shared MPS:

| Slide | Grid cells | Tissue cells | Tiles | Seconds | Seconds per tile |
|---|---:|---:|---:|---:|---:|
| test_001 | 1,400 by 1,344 | 292,029 | 837 | 411.5 | 0.49 |
| test_065 | 840 by 1,216 | 60,831 | 331 | 189.8 | 0.57 |
| test_013 | 3,456 by 1,512 | 120,105 | 363 | 214.6 | 0.59 |
| test_062 | 448 by 2,112 | 114,740 | 331 | 203.1 | 0.61 |

`test_001` reproduced AITUM-001 exactly through the new harness: FROC 1.000, 3 counted lesions, 74 detections, 28 false positives, Dice 0.908.

Areas: 33 outlines were matched with a pad of one cell. 5 outlines touched no listed area (1 on `test_001`, 3 on `test_065`, 1 on `test_013`). Stray areas were 2 on `test_001`, 1 on `test_013` and 1 on `test_062`. The mean absolute size error over outlines is 1.69 mm and the median 2.38 mm.

## Interpretation

- The pooled FROC of 0.722 equals the bundle's published 0.72 over 48 slides, and MONAI's code gives the same number, so the port and the job hold on micro slides and on the isolated cell path too. Six lesions make it coarse: one more lesion found at a quarter of a false positive per slide moves it by about 0.03.
- All six counted lesions were found above 0.5. What costs FROC is the false positives that score as high as the small lesions: on `test_013` a false positive reaches 1.000, above its one lesion at 0.965, and on `test_065` 30 false positives sit around its 0.78 lesion. The micro slides each score 0.5 on their own.
- The normal slide has 26 detections above 0.5 and one listed area. False alarms, not missed tumour, are the weakness of the v1 map, which is what a reviewer would have to dismiss.
- Pooled Dice of 0.899 is carried by the large deposits of `test_001`. On the micro slides Dice is 0.61 and 0.42, because a 64 px cell grid is coarse against deposits of a few cells. The mean per slide of 0.649 shows that.
- The size error is not usable yet. `evaluate_areas` matches each XML polygon, and `test_001` outlines one deposit with many polygons, so 29 small outlines inside one large found area each take that area's length and show errors of about 2.5 mm. Size error should be scored per grown lesion, not per polygon, before it gates anything.
- Three of the four slides come from centre 1, so this says little about scanner and centre shift.
- Speed was 0.49 to 0.61 s per tile on a shared MPS, so every slide here took under 7 minutes.

## Follow-ups

- The promotion gate's tumor map entry now uses these numbers as its baseline, FROC 0.7222 and Dice 0.8986 on the same three slides, with ADR 0322's tolerance of 0.01, as ADR 0351 (the v1 tumor model stays the MONAI CAMELYON ResNet18) says.
- Size error is now scored per grown lesion with cell matching in [the tumor area sizes result](2026-11-16-tumor-area-sizes-on-three-test-slides.md), median 0.010 mm over 7 matched deposits. TODO: add it to the gate.
- TODO: a second centre 0 slide and a macro slide from centre 0 would make the reference less one-scanner. The `tumor-eval` group is where they go.
- The new slide files were deleted after the run to save disk. The XML outlines and the cached maps in `~/.cache/parfocal/tumor-maps` (9.1 MB) are kept. `pnpm fixtures tumor-eval` fetches the slides again (3.3 GB with `test_001`).
