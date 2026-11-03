# Result: HoVer-NeXt reaches an ECE of 0.022 with one view and 0.019 with 8 views after temperature scaling, and the registry stores those rows

- Date: 2026-11-04
- Backlog: AINUC-006 (calibration)
- Kind: ML evaluation
- Commit: 1a01b096 plus the uncommitted `parfocal_ml.calibration` of AINUC-006
- Environment: MacBook (Apple silicon, arm64), macOS, Python 3.14 through uv, numpy. No GPU, because no model runs
- Data: the POC's cached HoVer-NeXt outputs on PanNuke (`poc/server/fixtures/pannuke/hovernext-{train,test}.views.f32` and `.labels.u8`), the same files as the [2026-10-18 reproduction](2026-10-18-typing-calibration-reproduction.md). Fitting split: fold 1, 17,278 nuclei. Test split: every fifth image of fold 3, 12,928 nuclei, with each nucleus's PanNuke tissue from `fold3-nuclei.npz`. Nothing is committed

## Question

Does temperature scaling per typer and test-time view count, fitted on a split separate from the test split, bring the active typer (HoVer-NeXt behind the catalogue's `pathosam-hovernext` v1.2, the Best typer tier) under an ECE of 0.05, and what are the test-set fields the model warnings of REVIEW-014 read?

## Method

`uv run python -m parfocal_ml.calibration /Users/yuriifedas/WebstormProjects/poc/server/fixtures/pannuke` from `workers/ml`. For one view and for the mean of 8 views it fits one scalar temperature on fold 1 by the lowest NLL over 0.50 to 10.00 in steps of 0.01, applies it to fold 3 and computes:

- ECE with 10 bins, before and after.
- Test-set accuracy.
- Confident share, the share of nuclei whose calibrated top probability is 0.80 or more.
- Unsure share as the viewer's `slideStatistics` counts it: top probability under 0.40, or the first two classes less than 0.10 apart.
- Validated sites, every PanNuke tissue with at least 100 test nuclei typed at least 70% right (the warning rules' `minimumTypedCells` and `minimumAccuracy`).

`workers/ml/tests/test_calibration.py` checks that the rows in `apps/api/src/parfocal_api/model_catalogue.py` equal what this fit gives, whenever the cached outputs are present.

## Results

| Views | Temperature | ECE before | ECE after | Accuracy | Confident share | Unsure share |
|---|---|---|---|---|---|---|
| 1 | 1.42 | 0.0323 | 0.0223 | 0.8297 | 0.5941 | 0.0755 |
| 8 | 1.29 | 0.0202 | 0.0187 | 0.8348 | 0.6076 | 0.0694 |

Accuracy per tissue on the test split, one view and 8 views, with the nucleus count:

| Tissue | Nuclei | 1 view | 8 views |
|---|---|---|---|
| Adrenal Gland | 450 | 0.842 | 0.836 |
| Bile Duct | 734 | 0.797 | 0.804 |
| Bladder | 287 | 0.854 | 0.850 |
| Breast | 2831 | 0.849 | 0.853 |
| Cervix | 372 | 0.782 | 0.788 |
| Colon | 2518 | 0.849 | 0.856 |
| Esophagus | 663 | 0.885 | 0.891 |
| Head & Neck | 731 | 0.817 | 0.817 |
| Kidney | 205 | 0.790 | 0.800 |
| Liver | 393 | 0.796 | 0.794 |
| Lung | 448 | 0.688 | 0.685 |
| Ovarian | 244 | 0.910 | 0.906 |
| Pancreatic | 179 | 0.838 | 0.855 |
| Prostate | 275 | 0.804 | 0.825 |
| Skin | 225 | 0.782 | 0.782 |
| Stomach | 339 | 0.858 | 0.867 |
| Testis | 247 | 0.830 | 0.866 |
| Thyroid | 306 | 0.768 | 0.745 |
| Uterus | 1481 | 0.823 | 0.834 |

So 18 of 19 tissues are validated sites for both view counts, and Lung is not.

## Interpretation

- The done-when line holds on the POC's cached outputs: ECE after calibration is 0.0223 and 0.0187, under 0.05. Temperatures, ECE and accuracy equal the 2026-10-18 reproduction and POC doc 29.
- The unsure share here is the viewer's doubtful-or-close count, not the unsure band of doc 29 (0.117 and 0.105), so the many-unsure warning compares a slide with its test set on the same measure.
- These are the POC's HoVer-NeXt outputs, not a run of the chosen weights in Parfocal. ADR 0202 (v1 model line-up) asks for a refit on the shipped weights, which needs the typer runner of AINUC-002 to produce fresh outputs. Rerun the command above on those outputs and update the catalogue rows.
- Lung at 0.688 sits just under the 0.70 cut, so a lung slide gets the site-not-validated warning. That is a consequence of the chosen rule, labelled as such.

## Follow-ups

- The rows live in the code catalogue until AIP-002 (model registry) adds a registry table, which should carry them over with the fitting split and the result file link.
- AILEARN-005 (recalibration after each round) writes new rows. Running tasks keep their stored order, as ADR 0117 (review order stored per task slide) says.
