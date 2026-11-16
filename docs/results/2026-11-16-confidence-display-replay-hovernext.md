# Result: the confidence display checks of ADR 0194 replay exactly for HoVer-NeXt with one view and hold with 8 views, where fewer open regions settle

- Date: 2026-11-16
- Backlog: AINUC-000 (nuclei detector and typer research check)
- Kind: ML evaluation
- Commit: the AINUC-000 commit that adds this file
- Environment: Apple M4, 24 GB, macOS 15 (Darwin 24.6), Python 3.14 through uv, numpy. No model runs and no GPU. Three other agents shared the machine
- Data: the POC's cached HoVer-NeXt outputs on PanNuke (`poc/server/fixtures/pannuke/hovernext-{train,test}.views.f32` and `.labels.u8`, `fold3-nuclei.npz`), the same files as the [calibration result](2026-11-04-typer-calibration-registry.md). Temperature fitted on fold 1, 17,278 nuclei. Test: every fifth image of fold 3, 12,928 nuclei, grouped into 32 regions of whole images of one tissue with at least 300 nuclei each (mean 316). Public data, no PHI, nothing committed

## Question

ADR 0194 (confidence display rules and evidence) asks AINUC-000 to replay its table for the typer it picks. The pick is HoVer-NeXt, one view for the Good tier and the mean of 8 views for Best. Does the new MLEVAL module reproduce POC doc 33's numbers for one view, and do the typer-dependent rules still hold with 8 views?

## Method

```
uv run --package parfocal-ml python -m parfocal_ml.confidence_display /Users/yuriifedas/WebstormProjects/poc/server/fixtures/pannuke
```

`parfocal_ml.confidence_display` is new code written for this task from the method of doc 33. It takes calibrated probabilities from `type_evaluation.scaled` with the temperature `fit_temperature` gives, then computes the tumor share ranges and how often they give a firm answer at the cutoffs 10, 20, 30 and 50%, the error left after checking 5% of cells in three orders, the "about N cells" walk, the AUROC of each overlay for wrong calls, the plain-word accuracies, the frequency-word gaps per tissue and band, the model warnings per tissue and the track record per band. `workers/ml/tests/test_confidence_display.py` checks the one-view numbers against the POC's stored `confidence-display.json` whenever the cached outputs are present.

## Results

| Check (ADR 0194 row) | 1 view, T 1.42 | 8 views, T 1.29 |
|---|---|---|
| Test accuracy | 0.830 | 0.835 |
| Bands, share and right: confident, likely, unsure, doubtful | 59.4% 95.0%, 27.8% 72.2%, 11.7% 51.2%, 1.1% 43.8% | 60.8% 95.5%, 27.5% 70.6%, 10.5% 52.3%, 1.2% 44.2% |
| Unsure cell: flags, of those wrong, share of all mistakes caught | 7.5%, 52.2%, 23.1% | 6.9%, 50.5%, 21.2% |
| Overlay AUROC for wrong calls: fade, bands, map, mark | 0.819, 0.780, 0.663, 0.594 | 0.824, 0.787, 0.671, 0.585 |
| Faintest fifth of fade holds this share of mistakes | 53.6% | 53.0% |
| Expected mistakes range: covers truth, firm answers, wrong firm answers | 21 of 32 (65.6%), 87.5%, 0 | 20 of 32 (62.5%), 89.8%, 0 |
| Flips range: covers truth, firm, wrong firm | 40.6%, 95.3%, 2 | 37.5%, 96.1%, 2 |
| Binomial range: covers truth, firm, wrong firm | 25.0%, 89.1%, 0 | 37.5%, 90.6%, 1 |
| Share error after checking 5%: tumor most contested, least sure, random (points) | 2.35, 2.75, 3.12 | 2.48, 3.03, 3.20 |
| "About N cells": open cases, settled, settled right, mean share checked | 16, 12, 12, 18.2% | 13, 7, 7, 19.0% |
| Plain words, first right: "A", "probably A", "possibly A", "A or B" (either), "unclear" (either) | 95.0%, 72.2%, 54.5%, 48.6% (92.4%), 43.8% (75.7%) | 95.5%, 70.6%, 54.4%, 50.6% (91.6%), 44.2% (73.1%) |
| Frequency words, tissue and band cells off by 2 in 10 or more | 3 of 54 | 3 of 54 |
| Warnings fire on, of 19 tissues | 1 | 1 |
| Track record after reviewing every unsure cell: kept, against right overall | 47.2% against 83.0% | 49.8% against 83.5% |

## Interpretation

- One view reproduces doc 33 and the POC's stored file on every number the test checks, including the random check order, so the module is a faithful replay.
- The frequency-word count is 3 of 54 only when the stated band accuracy is rounded to three decimals as the catalogue stores it. At full precision it is 2 of 54, because the confident band's 0.9497 rounds to 9 in 10 and the stored 0.950 rounds to 10. The module uses the stored value, since that is what the app quotes.
- With 8 views every typer-dependent rule still holds. The expected mistakes range gives no wrong firm answer, so firm answers may turn on for both view counts under ADR 0194's gate. The binomial range gives one wrong firm answer with 8 views, which is one more reason it stays unused.
- The weaker point with 8 views is the "about N cells" claim. 7 of 13 open cases settle (54%) against 12 of 16 (75%) with one view. All that settle are right, so the "should settle it" wording stays allowed, and the rule already says "should".
- The tumor-contested order beats least sure and random with both view counts, so the cells to check rule is not typer dependent here.
- Not rerun here: the vector scaling evidence of doc 28, the CMU-1 warning figure of doc 29 and the "may not be a nucleus" thresholds. They depend on the CoNSeP classifier, on a POC whole-slide run and on PathoSAM outlines, not on these cached outputs.
- These are still the POC's HoVer-NeXt outputs on true outlines, not outputs of the Parfocal typer runner on PathoSAM outlines. When the runner of AINUC-002 (typer runner) writes fresh outputs, the command above reruns on them.
