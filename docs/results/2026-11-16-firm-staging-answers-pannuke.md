# Result: firm staging answers were never on the wrong side of 200 tumor cells on 86 PanNuke clusters, with one view or eight

- Date: 2026-11-16
- Backlog: REVIEW-020 (firm staging answers on a validation set)
- Kind: ML evaluation
- Commit: the REVIEW-020 commit that adds this file
- Environment: Apple M4, 24 GB, macOS 15 (Darwin 24.6), Python 3.14 through uv, numpy. No model runs and no GPU. Other agents shared the machine
- Data: the POC's cached HoVer-NeXt outputs on PanNuke (`poc/server/fixtures/pannuke/hovernext-{train,test}.views.f32` and `.labels.u8`, `fold3-nuclei.npz`), the same files POC doc 33 and the [confidence display replay](2026-11-16-confidence-display-replay-hovernext.md) used. Temperature fitted on fold 1, 17,278 nuclei. Test: every fifth image of fold 3, 12,928 nuclei with true types. PanNuke is CC BY-NC-SA 4.0 (Gamper et al., Warwick TIA). Public data, no PHI

## Question

ADR 0086 (node staging rules) calls a tumor cell count firm when its range cannot cross 200, and moved the check that firm answers are never wrong to this task. Run `stage_node` on labelled clusters. Is a firm count ever on the wrong side of the true count?

## Method

```
uv run --package parfocal-ml python -m parfocal_ml.staging_validation /Users/yuriifedas/WebstormProjects/poc/server/fixtures/pannuke --fixture workers/ml/tests/fixtures/staging-validation-pannuke.npz
```

`parfocal_ml.staging_validation` is new. Each nucleus becomes a `TypedCell` with the cached class probabilities, `area_count.count_members` applies the fitted temperature (1.42 for one view, 1.29 for the mean of 8 views) and gives the cells, and `node_staging.stage_node` stages one area that is confirmed tumor and measured at 0.15 mm, so the count decides. A firm answer is a settled stage. Its category is right when it matches the PanNuke label count, micrometastasis over 200 true tumor cells and isolated tumor cells otherwise. The labels stand in for the pathologist's count.

The cluster rule and sizes were fixed before any outcome was seen. A cluster is whole images of one tissue, in image order, gathered until it holds at least N nuclei, as doc 33 built its regions. N is 300 (doc 33's 32 regions), 400, 500, 600 and 800, so true counts fall on both sides of 200. Leftover images at the end of a tissue are dropped. "Near" means a true count within 50 of 200.

A second pass, kept out of the headline, takes every open cluster and checks cells one at a time, most contested tumor call first (tumor probability nearest 50%), with a reviewer who always gives the true type, until the stage settles.

The fixture stores each nucleus's image, tissue, true tumor flag and, for 1 and 8 views, the calibrated tumor probability rounded to 1/65535 and the tumor call (54 KB). Rounding changes no count in the report. `workers/ml/tests/test_staging_validation.py` replays it and pins the numbers below.

## Results

| | 1 view, T 1.42 | 8 views, T 1.29 |
|---|---|---|
| Clusters, with a true count over 200 | 86, 38 | 86, 38 |
| Firm answers | 71 of 86 (82.6%) | 71 of 86 (82.6%) |
| Wrong firm answers | 0 | 0 |
| Clusters near 200, firm, wrong firm | 25, 10, 0 | 25, 10, 0 |
| Range covers the true count | 65 of 86 (75.6%) | 64 of 86 (74.4%) |
| Point count (tumor calls) on the wrong side of 200 | 1 | 1 |
| Breast clusters: total, firm, wrong firm | 27, 24, 0 | 27, 24, 0 |
| Open clusters checked until settled: settled, right, cells checked | 15 of 15, 15, 978 (16.7% of their cells) | 15 of 15, 15, 944 (16.3%) |

Per size, one view (8 views is the same except where noted):

| N | Clusters | True over 200 | Firm | Wrong firm | Near | Near and firm | Covers truth |
|---|---|---|---|---|---|---|---|
| 300 | 32 | 8 | 26 | 0 | 13 | 7 | 21 (20 with 8 views) |
| 400 | 20 | 10 | 15 | 0 | 6 | 1 | 16 (15) |
| 500 | 14 | 7 | 12 | 0 | 3 | 1 | 12 |
| 600 | 13 | 8 | 11 | 0 | 2 | 0 | 10 (11) |
| 800 | 7 | 5 | 7 | 0 | 1 | 1 | 6 |

There is no wrong firm answer to list. The 10 firm answers near 200, one view, as low, tumor calls, high and true count, with N and tissue:

| N | Tissue | Low | Calls | High | True |
|---|---|---|---|---|---|
| 300 | Breast | 147.1 | 171 | 184.2 | 178 |
| 300 | Breast | 133.0 | 153 | 163.9 | 163 |
| 300 | Breast | 149.3 | 168 | 176.4 | 182 |
| 300 | Breast | 223.7 | 255 | 263.2 | 249 |
| 300 | Esophagus | 216.9 | 232 | 237.7 | 245 |
| 300 | Uterus | 208.1 | 251 | 263.9 | 243 |
| 300 | Uterus | 224.8 | 257 | 267.8 | 224 |
| 400 | Uterus | 225.3 | 258 | 273.4 | 224 |
| 500 | Breast | 216.0 | 246 | 264.8 | 241 |
| 800 | Colon | 224.0 | 249 | 261.7 | 245 |

## Interpretation

- The ADR 0086 count rule holds on this set. No firm answer was on the wrong side of 200 with either view count, so firm staging answers can stay on.
- The evidence near the cutoff is thin. Only 10 firm answers had a true count within 50 of 200, the closest 22 cells away (178 and 224). The other 61 firm answers prove little, since their counts are far from 200. The range missed the true count in about a quarter of clusters, four of them among the 10 near firm answers (182 above a high of 176.4, 245 above 237.7, and 224 just under lows of 224.8 and 225.3), so the margin is the range's width, not its coverage.
- Clusters of different sizes reuse the same images, so the 86 are not independent. The 32 at N 300 are.
- The one point count on the wrong side cannot be a firm cluster, since a firm range holds its point count on the right side, so the range kept that cluster open.
- Checking the most contested cells settled every open cluster, all on the right side, after about a sixth of their cells, in line with doc 33's 12 of 16.
- Limits. These are true outlines, so missed and extra detections are not tested. The clusters are stitched from 64 µm images, not real deposits of 0.2 mm or less, and they are about 43% tumor, more mixed than a real cluster, which widens the high end. The true count is the PanNuke label, not a pathologist counting on a slide. A rerun on the Parfocal typer runner's outputs on PathoSAM outlines is the next check, with the same command once AINUC-002 (typer runner) writes them.
