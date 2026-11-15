# Result: a trained typer round on PanNuke needs its own temperature, 1.79, which brings its ECE from 0.089 with the old 1.29 to 0.019

- Date: 2026-11-15
- Backlog: AILEARN-005 (recalibration after each round)
- Kind: ML evaluation
- Commit: the AILEARN-005 commit on its worktree branch
- Environment: MacBook (Apple silicon, arm64), macOS, Python 3.14 through uv, numpy. No GPU. The whole command takes about 10 seconds
- Data: the POC's cached PanNuke outputs in `poc/server/fixtures/pannuke`: HoVer-NeXt 8-view probabilities (`hovernext-{train,test}.views.f32`), the pooled 512-value PathoSAM features with each nucleus's image (`pathosam-features.npz`) and the tissue of each fold 3 nucleus (`fold3-nuclei.npz`). Training side: fold 1, 17,278 nuclei. Held-out side: every fifth image of fold 3, 12,928 nuclei on 523 images. Nothing is committed

## Question

When a training round changes the typer, does the temperature fitted for the old version still calibrate it, and does `parfocal_ml.round_calibration` give the new round a temperature and four bands that do?

## Why the round is synthetic

AILEARN-004 (server training rounds per tenant) is not built, so no real round exists. The stand-in round is a softmax head trained the way a round would be: 300 full-batch steps of softmax regression on fold 1 with the pooled PathoSAM features and the typer's 8-view log-probabilities as inputs, then run on fold 3. Each PanNuke image stands in for a slide. The head is a genuinely different model from the typer, not the typer's outputs sharpened by a known factor, so the fitted temperature is measured and not known in advance.

## Method

`uv run python -m parfocal_ml.round_calibration poc-round /Users/yuriifedas/WebstormProjects/poc/server/fixtures/pannuke` from `workers/ml`. The held-out images are split by a hash of the slide key: 277 images (7,045 nuclei) fit the temperature and 246 images (5,883 nuclei) measure it. The temperature fit is the one of AINUC-006 (calibration), the lowest NLL over 0.50 to 10.00 in steps of 0.01, and ECE uses 10 bins. Every row below is measured on the same 5,883 nuclei.

## Results

The round's head types 69.2% of the measuring nuclei right, against 82.4% for the typer it started from.

| Temperature applied to the round | Temperature | ECE |
|---|---|---|
| None | 1.00 | 0.1381 |
| The old version's, v1.2 with 8 views | 1.29 | 0.0892 |
| Fitted on the round's own training side | 1.22 | 0.1000 |
| Refitted on the held-out fit slides | 1.79 | 0.0187 |

The refitted round's bands on the measuring slides, at the fixed cutoffs 0.80, 0.55 and 0.40:

| Band | Share | Accuracy |
|---|---|---|
| Confident | 0.355 | 0.865 |
| Likely | 0.396 | 0.679 |
| Unsure | 0.204 | 0.490 |
| Doubtful | 0.045 | 0.360 |

With the old temperature the confident band holds 0.531 of the nuclei at an accuracy of 0.825, and with none it holds 0.649 at 0.792. The refitted round's unsure share, as the viewer counts it, is 0.107, and 7 of 19 tissues pass the validated site rule (at least 100 nuclei typed at least 70% right).

## Interpretation

- The old temperature does not carry over. A round that is more confident than it is right keeps an ECE of 0.089 with the v1.2 temperature and 0.100 with a temperature fitted on its own training examples, both over the 0.05 that AINUC-006 (calibration) asks of the typer. Refitting on held-out slides brings it to 0.019. So each promoted round needs its own fit, and the fit must never see the round's training examples.
- This head is worse than the typer, so MLEVAL's promotion gate would refuse this round. That does not weaken the calibration finding. It shows that a recalibration works on a round's outputs whatever their quality, and that the bands then tell a reviewer honestly that fewer cells are confident.
- The minimum held-out size is 5 slides and 500 nuclei on each half. A round below it cannot be promoted. The numbers are a starting rule chosen by judgement, not measured here.

## Follow-ups

- AILEARN-004 (server training rounds per tenant) calls `recalibrate` with its round's held-out outputs and the AILEARN-006 (held-out validation split) predicate, and `promote` refuses a round without a temperature and four bands for each view count.
- Where the rows are stored waits on AILEARN-004 and the registry tables. `catalogue_row` gives them the rounding of the code catalogue in `model_catalogue.py`, and the v1.2 rows there stay unchanged.
- Rerun the command on the first real round's outputs with `python -m parfocal_ml.round_calibration round OUTPUTS.npz --typer NAME --version ROUND` and replace the synthetic numbers here.
