# Result: the typing and calibration harness reproduces POC doc 29 for HoVer-NeXt

- Date: 2026-10-18
- Backlog: MLEVAL-004 (typing and calibration evaluation)
- Kind: ML evaluation
- Commit: 4ad5a76 plus the uncommitted `parfocal_ml.type_evaluation` of MLEVAL-004
- Environment: MacBook (Apple silicon, arm64), macOS 15.8.1, Python 3.14 through uv, numpy. No GPU, because no model runs
- Data: the POC's cached HoVer-NeXt outputs on PanNuke (`poc/server/fixtures/pannuke/hovernext-{train,test}.views.f32` and `.labels.u8`), class-head probabilities for 8 flips and rotations of each nucleus already mapped to the viewer classes tumor, stroma, immune and other. Fitting set: fold 1, 17,278 nuclei. Test set: every fifth image of fold 3, 12,928 nuclei. Nothing is committed

## Question

Does `parfocal_ml.type_evaluation.evaluate` give POC doc 29's numbers for HoVer-NeXt on the same fold: accuracy, balanced accuracy, per-class recall and precision, the temperature fitted on fold 1, ECE before and after, and the band shares and accuracies?

## Method

Average the first view or all 8 views per nucleus, fit the temperature on fold 1 by the lowest NLL over 0.50 to 10.00 in steps of 0.01, apply it to fold 3, and compute the metrics with a 10-bin ECE and the bands confident (80% and over), likely (55%), unsure (40%) and doubtful. `workers/ml/tests/test_type_evaluation.py` checks every number below when the cached outputs are present.

## Results

| Views | Accuracy | Balanced | Temperature | ECE before, after | Recall: tumor, stroma, immune, other | Precision: tumor, stroma, immune, other |
|---|---|---|---|---|---|---|
| 1 | 0.8297 | 0.8166 | 1.42 | 0.0323, 0.0223 | 0.882, 0.784, 0.761, 0.839 | 0.903, 0.762, 0.747, 0.844 |
| 8 | 0.8348 | 0.8212 | 1.29 | 0.0202, 0.0187 | 0.889, 0.785, 0.772, 0.838 | 0.904, 0.770, 0.759, 0.846 |

| Views | Confident: share, right | Likely | Unsure | Doubtful |
|---|---|---|---|---|
| 1 | 0.594, 0.950 | 0.278, 0.722 | 0.117, 0.512 | 0.011, 0.438 |
| 8 | 0.608, 0.955 | 0.275, 0.706 | 0.105, 0.523 | 0.012, 0.442 |

Doc 29 reports 83.0% and 81.7% (one view), 83.5% and 82.1% (8 views), temperatures 1.42 and 1.29, ECE 0.032 to 0.022 and 0.020 to 0.019, recall 88, 78, 76, 84 and precision 90, 76, 75, 84, and the band numbers above in whole percent. The bands also match the POC's `calibration.json` to three decimals.

## Interpretation

- Every number matches doc 29 at the precision the doc gives. The one visible difference is the 8-view confident band, 0.955 here and "96%" in the doc, which is the same value rounded up.
- This reproduces the evaluation, not the model: the probabilities are the POC's cached outputs. Rerunning HoVer-NeXt is part of AINUC-002 (typer runner).

## Follow-ups

- TODO: move the cached outputs into the dataset cache with a checksum when MLEVAL-010 (loaders for datasets behind a sign-in) adds PanNuke.
