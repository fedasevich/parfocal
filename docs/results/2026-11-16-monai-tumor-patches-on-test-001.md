# Result: the MONAI tumor model on 400 patches of test_001, a CAMELYON16 test slide

- Date: 2026-11-16
- Backlog: AITUM-000 (tumor map research check)
- Kind: ML evaluation
- Commit: the AITUM-000 commit on top of `0898c810` (`workers/ml/spike/tumor_patch_check.py`)
- Environment: Apple M4, macOS 15.8.1, MPS capped at 30% of the working set, the POC's server venv (Python 3.12.14, torch 2.14.0, MONAI 1.6.0, openslide-python 1.4.6 on OpenSlide 4.0.1, shapely 2.1.2)
- Data: `test_001.tif` and `test_001.xml` from the `camelyon` fixture group (CAMELYON16, CC0 per the bundle's `data_license.txt`), `tumor_009.tif` and the POC's stored map `server/fixtures/tumor/tumor_009.npz`. Weights: MONAI `pathology_tumor_detection` 0.6.4 `models/model.pt` from the POC checkout, 44.8 MB, SHA-256 `5a0d9b9e714e18a90c1f7f7d9c7e47f807c59f9f8c681b84865fae208fcbb4d6`

## Question

Does the MONAI CAMELYON ResNet18, which ADR 0202 (v1 model line-up per tier) made the v1 tumor model, separate tumour from normal tissue on a slide it was not trained on? So far the repository had only `tumor_009`, a training slide (POC doc 17, Dice 0.904 at 0.5 over the whole slide). This is a small patch check and not the lesion-level FROC of 0.72 the bundle reports on 48 test slides, which MLEVAL-005 (tumor map evaluation) will measure.

## Method

```
<POC>/server/.venv/bin/python workers/ml/spike/tumor_patch_check.py \
  <POC>/server/apps/pathology/model/pathology_tumor_detection/models/model.pt \
  ~/.cache/parfocal/fixtures/test_001.tif ~/.cache/parfocal/fixtures/test_001.xml \
  ~/.cache/parfocal/fixtures/tumor_009.tif <POC>/server/fixtures/tumor/tumor_009.npz out.json 200
```

1. Preprocessing is the bundle's `configs/inference.json` and the POC's `tumor.py`: level 0, 224 px RGB, alpha 0 set to white, scaled from 0..255 to -1..1, sigmoid of the 1×1 logit. No rescaling for the slide's 0.226 µm/px, as the bundle does not rescale.
2. Sanity check first. On 40 random tissue cells of `tumor_009` (seed 20261116), the four 224 px windows at 32 px stride that the POC averages into one 64 px cell are scored and compared with the stored map.
3. On `test_001`, positives are 200 random 224 px boxes that lie wholly inside the union of the 30 `Tumor` polygons minus the one `None` polygon. Negatives are 200 random 224 px boxes on tissue (HSV saturation above the slide's Otsu threshold of 66.5 on the level 6 thumbnail, and at least half of the box's pixels above it at level 0) whose box is at least 448 px from every annotation. Only 224 px regions and the level 6 thumbnail are read, never the whole slide.
4. AUC by ranks, a 95% interval from 1,000 bootstrap rounds, and sensitivity and specificity at 0.5, 0.7 and 0.9.

## Results

Sanity check against the POC's stored map of `tumor_009`:

| Cells | Pearson r | Mean absolute difference | Same side of 0.5 |
|---:|---:|---:|---:|
| 40 | 0.998 | 0.014 | 40 of 40 |

`test_001`, 200 tumour and 200 normal patches:

| AUC | 95% interval | Median score, tumour | Median score, normal |
|---:|---|---:|---:|
| 0.9996 | 0.9989 to 1.0000 | 0.994 | 0.0015 |

| Threshold | Sensitivity | Specificity |
|---:|---:|---:|
| 0.5 | 0.960 | 1.000 |
| 0.7 | 0.915 | 1.000 |
| 0.9 | 0.825 | 1.000 |

The run, including the sanity check, took 8.9 s on MPS.

## Interpretation

- The patch scorer reproduces the POC's map closely, so the preprocessing is right. The small difference is expected, because the POC runs one large tile through the convolutions and this check runs single 224 px windows.
- On an unseen slide the model separates interior tumour from tissue far from any tumour almost perfectly, and at 0.5 it misses 4% of tumour patches and calls no normal patch tumour. That matches POC doc 17, where the model misses tumour edges more than it raises false alarms.
- This sampling is easy on purpose. It skips the tumour border, the 448 px ring around it, micrometastases on other slides and other scanners. It is one slide, so it says the model works off its training set, not how good it is. It is not comparable with the bundle's FROC of 0.72 or with any slide-level AUC.

## Follow-ups

- ADR 0351 (the v1 tumor model and its evaluation) uses this as the one measured number for the MONAI model on a test slide.
- TODO: lesion-level FROC and Dice on at least three CAMELYON16 test slides, including border pixels, which is MLEVAL-005.
