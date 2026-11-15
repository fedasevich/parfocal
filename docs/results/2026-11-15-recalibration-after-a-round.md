# Result: two stand-in typer rounds on PanNuke keep an ECE of 0.077 and 0.089 with the old temperature and reach 0.015 and 0.019 after refitting on held-out slides

- Date: 2026-11-15
- Backlog: AILEARN-005 (recalibration after each round)
- Kind: ML evaluation
- Commit: the AILEARN-005 commits on its worktree branch
- Environment: MacBook (Apple silicon, arm64), macOS, Python 3.14 through uv, numpy. No GPU. The whole command takes about 15 seconds
- Data: the POC's cached PanNuke outputs in `poc/server/fixtures/pannuke`: HoVer-NeXt 8-view probabilities (`hovernext-{train,test}.views.f32`), the pooled 512-value PathoSAM features with each nucleus's image (`pathosam-features.npz`) and the tissue of each fold 3 nucleus (`fold3-nuclei.npz`). The feature rows line up with the HoVer-NeXt rows: labels agree on every nucleus of both folds and the images agree with `fold3-nuclei.npz`. Training side: fold 1, 17,278 nuclei. Held-out side: every fifth image of fold 3, 12,928 nuclei on 523 images. Nothing is committed

## Question

When a training round changes the typer, does the temperature fitted for the old version still calibrate it, and does `parfocal_ml.round_calibration` give the new round a temperature and four bands that do?

## Why the rounds are stand-ins

AILEARN-004 (server training rounds per tenant) is not built, so no real round exists. Two stand-ins are trained on fold 1 and run on fold 3, with each PanNuke image standing in for a slide. Both are softmax heads trained by 300 full-batch gradient steps at a rate of 0.5 with weight decay 0.0001, on the pooled PathoSAM features. They are different models from the typer, not its outputs sharpened by a known factor, so the fitted temperature is measured and not known in advance.

- Starts from the typer: the typer's 8-view log-probabilities are a fixed offset and the head learns a correction from zero weights, which is the nearest to AILEARN-004's "fine-tune the typer head from pretrained weights".
- Starts from zero: the log-probabilities are four more inputs, as in the browser learner of AILEARN-002 (per-slide learner).

Both heads reach the typer's accuracy on fold 1 (0.865 for the second, against 0.867 for the typer) and lose it on fold 3, because the features do not carry across folds. More steps, a lower rate or more weight decay did not change that. The lower rate of 0.05 gave 0.679 on fold 3, and a decay of 0.01 gave 0.643.

## Method

`uv run python -m parfocal_ml.round_calibration poc-round /Users/yuriifedas/WebstormProjects/poc/server/fixtures/pannuke` from `workers/ml`. The held-out images are split by a hash of the slide key: 277 images (7,045 nuclei) fit the temperature and 246 images (5,883 nuclei) measure it. The temperature fit is the one of AINUC-006 (calibration), the lowest NLL over 0.50 to 10.00 in steps of 0.01, and ECE uses 10 bins. Every row below is measured on the same 5,883 nuclei, where the typer itself types 82.4% right.

## Results

| Temperature applied | Starts from the typer | Starts from zero |
|---|---|---|
| Round accuracy | 0.764 | 0.692 |
| None (1.00) | ECE 0.1135 | ECE 0.1381 |
| Old version's, v1.2 with 8 views (1.29) | ECE 0.0771 | ECE 0.0892 |
| Fitted on the round's own training side | 1.43, ECE 0.0592 | 1.22, ECE 0.1000 |
| Refitted on the held-out fit slides | 1.85, ECE 0.0152 | 1.79, ECE 0.0187 |

The refitted bands on the measuring slides, at the fixed cutoffs 0.80, 0.55 and 0.40, as share and accuracy:

| Band | Starts from the typer | Starts from zero |
|---|---|---|
| Confident | 0.518, 0.918 | 0.355, 0.865 |
| Likely | 0.325, 0.673 | 0.396, 0.679 |
| Unsure | 0.132, 0.461 | 0.204, 0.490 |
| Doubtful | 0.025, 0.378 | 0.045, 0.360 |

With the old temperature the confident band of the first round holds 0.672 of the nuclei at an accuracy of 0.878, against 0.518 at 0.918 after the refit. The refitted unsure share, as the viewer counts it, is 0.078 and 0.107, and 12 and 7 of 19 tissues pass the validated site rule (at least 100 measuring nuclei typed at least 70% right).

## Interpretation

- On both stand-ins the old temperature does not carry over, with ECEs of 0.077 and 0.089 over the 0.05 AINUC-006 (calibration) asks of the typer, and a temperature fitted on the round's training examples is no better than 0.059. Refitting on held-out slides brings both to 0.015 and 0.019. That is the case for a fit per round on slides the round never trained on.
- Both stand-ins type worse than the typer, so MLEVAL's promotion gate would refuse them, and a real round that improves on the typer may drift less. The finding is limited to rounds like these. It does show that the recalibration works on any round's outputs and that the refitted bands then report honestly that fewer cells are confident.
- The minimum held-out size is 5 slides and 500 nuclei on each half. A round below it cannot be promoted. The numbers are a starting rule chosen by judgement, not measured here.

## Follow-ups

- AILEARN-004 (server training rounds per tenant) calls `recalibrate` with its round's held-out outputs and the AILEARN-006 (held-out validation split) predicate, then `promote` with every view count the round will serve, which refuses a round that lacks a temperature and four bands for any of them.
- Where the rows are stored waits on AILEARN-004 and the registry tables. `catalogue_row` gives them the rounding of the code catalogue in `model_catalogue.py`, and the v1.2 rows there stay unchanged.
- The browser learner of AILEARN-002 (per-slide learner) does not use the catalogue temperature, so this recalibration does not cover it.
- Rerun on the first real round's outputs with `python -m parfocal_ml.round_calibration round OUTPUTS.npz --typer NAME --version ROUND` and replace the stand-in numbers here.
