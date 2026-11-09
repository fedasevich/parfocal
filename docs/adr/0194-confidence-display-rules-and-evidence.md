# 0194. Confidence display rules are written over calibrated probabilities and are re-checked per typer

- Date: 2026-11-03
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: REVIEW-000 (review workspace research check). Informs REVIEW-005, REVIEW-006, REVIEW-008, REVIEW-011, REVIEW-012, REVIEW-013, REVIEW-014, REVIEW-017, REVIEW-018, AINUC-006 (calibration) and AINUC-007 (confidence bands)

## Context

REVIEW-000 asks to re-read POC [doc 28](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/28-type-confidence.md) (calibrated type confidence) and [doc 33](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/33-showing-confidence-to-doctors.md) (showing confidence to a doctor) and confirm that the confidence rules of the review workspace still hold for the typer AINUC chose. Both docs were re-read on 2026-11-03 together with [doc 29](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/29-better-typer-and-second-opinions.md), which changed doc 28's bands, and the POC constants in `src/segment/confidence.ts` and `src/segment/assist.ts`.

No typer is chosen yet. AINUC-000 (nuclei research check) is still open, and [ADR 0042](0042-model-licensing-policy.md) (model licensing policy) blocks every current typer, HoVer-NeXt included, and the PanNuke-fitted temperatures. The only typer with evidence is HoVer-NeXt, whose evaluation this repository reproduces to the POC's precision ([result](../results/2026-10-18-typing-calibration-reproduction.md), MLEVAL-004). The rules below can therefore be confirmed for HoVer-NeXt only.

Doc 28's numbers belong to the CoNSeP classifier, which was right on 49% of PanNuke nuclei. With that typer nothing worked: the range covered the truth in 25% of regions and its firm answers were right 71% of the time (doc 33). The rules depend on the typer far more than the backlog text suggests.

A search on 2026-11-03 found no published calibration study for CellViT, CellViT++ or HoVer-Net typing, so no outside number replaces the POC's. General pathology work agrees that temperature scaling calibrates without changing the predicted class ([Dundee, 2022](https://discovery.dundee.ac.uk/en/publications/calibration-of-deep-medical-image-classifiers-an-empirical-compar/)), which is why doc 28 chose it over vector scaling.

## Options considered

1. Fix the POC's thresholds and phrases as constants now, as the backlog tasks read. Simple, but a different typer would inherit claims such as "probably tumor is right about 7 in 10 times" that were only measured on HoVer-NeXt.
2. Wait for AINUC-000 before building any confidence display. Safe, but it blocks most of the review workspace on a licensing question with no date.
3. Write every rule as a function of calibrated probabilities with the POC values as defaults, store the per-typer numbers (temperature, band accuracies, test-set accuracy and confident share) with the typer, and let a typer drive the plain wording and firm answers only after MLEVAL replays doc 33's checks on it. Chosen.

## Decision

Option 3. The display rules and their evidence, all on HoVer-NeXt, PanNuke fold 3, 12,928 nuclei, temperature fitted on fold 1:

| Rule | Value | Evidence | Typer dependent |
| --- | --- | --- | --- |
| Calibration | One temperature per typer and view count, never vector scaling | HoVer-NeXt 1.42, ECE 0.032 to 0.022. Vector scaling on the classifier put 363 nuclei at 88% that were right 1.7% of the time (docs 28, 29, reproduced) | Temperature is |
| Bands | Confident 80% and over, likely 55%, unsure 40%, doubtful under 40% | Share and accuracy 59.4% at 95%, 27.8% at 72%, 11.7% at 51%, 1.1% at 44% (doc 29, reproduced) | Shares and accuracies are, cutoffs are not |
| Unsure cell | Calibrated top under 40%, or top two within 10 points | Flags 7.5% of nuclei, half of them wrong, holding 23% of all mistakes (doc 33) | Yes |
| Overlay default | Fade: fill alpha 0.12 + 0.88 x strength, strength (top minus 0.25) / 0.75 | AUROC for wrong calls 0.82 against 0.78 bands, 0.66 map, 0.59 mark. Faintest fifth holds 54% of mistakes (doc 33) | AUROC is |
| Tumor share range | Expected mistakes: low is the sum of tumor probabilities over tumor calls, high is the tumor call count plus the tumor probabilities of all other cells | Covers the true share in 66% of 32 regions, firm in 88%, no firm answer wrong. Flips: 41%, 1.6% wrong. Binomial: 25% (doc 33) | Coverage is |
| Range wording | "Counting its likely mistakes", never a confidence interval | It misses the truth in a third of regions (doc 33) | No |
| Cells to check | Tumor most contested first, tumor probability nearest 50%, over every cell | Share off by 2.3 points at 5% checked against 2.8 least sure first and 3.1 random (doc 33) | No |
| "About N cells" | Count of cells with contestedness 0.2 and over until the range clears the cutoff, assuming each check confirms | 12 of 16 open cases settled, all on the right side (doc 33). Say "should" | Yes |
| Plain words | Doubtful "unclear, perhaps A or B", close "A or B", unsure "possibly A", likely "probably A", confident "A" | First class right 95%, 72%, 54%, 49% (either 92%), 44% (either 76%) (doc 33) | Yes |
| Frequency words | Quote the band's measured accuracy, or say it was not measured | Off by 2 in 10 or more in 3 of 54 tissue and band pairs (doc 33) | Yes |
| Track record | Agreement per band, an overall figure only when every band that matters is checked, at least 20 reviewed and 5 calls per class | The queue's 47% kept against 83% right overall misleads, per band it matches within 3 points (doc 33) | No |
| Warnings | Typer under 70% on its test set, uncalibrated, confident share under 0.6 of the test set's when that is at least 20%, unsure share 15 points over the test set's, at least 100 typed cells | Fired on 1 of 19 PanNuke tissues, would fire on CMU-1 (23% confident against 59%) (docs 29, 33) | Reference shares are |
| May not be a nucleus | Detector score under 0.8 or HoVer-NeXt foreground under 0.5 | Flagged outlines right 20 to 78% against 82 to 97% unflagged (doc 29) | Yes, HoVer-NeXt only |

For HoVer-NeXt every rule holds as the backlog states it, with two corrections. The bands are doc 29's four, not doc 28's three. The unsure flag, which drives zones (REVIEW-018) and the hatched part of the number line (REVIEW-005), catches only a quarter of HoVer-NeXt's mistakes, because most of them sit in the likely band. The number line and the tumor share range therefore count every cell by its probability, the overlay grades every cell with fade, and the cells to check walk every cell, not only the unsure ones.

A typer without these numbers measured on held-out data gets the percent wording, an "uncalibrated" warning and no firm answers. Firm answers and "should settle it" turn on for a typer only when MLEVAL shows no wrong firm answer on held-out regions, as doc 33 did.

## Consequences

- AINUC-006 and AINUC-007 store, per typer and view count, the temperature, the four band shares and accuracies, the test-set accuracy and the confident and unsure shares. REVIEW-011, REVIEW-013 and REVIEW-014 read them and never hard-code HoVer-NeXt's.
- AINUC-000 must replay this table for the typer it picks, since ADR 0042 probably rules out HoVer-NeXt. Until then the evidence is HoVer-NeXt's, on PanNuke regions of 300 to 700 nuclei with a reviewer who is always right, and no doctor has used any of it.
- REVIEW-011 now cites these band cutoffs instead of doc 28's.
- The pathologist check that ADR 0013 (cell findings) attached to this task is done, see the wording review below. No pathologist will review the product, so the owner asked on 2026-11-04 that an agent do it with standard histopathology terms (decision 44).

## Wording review of zone names and type hints, 2026-11-04

Simulated check, no pathologist took part ([agent-stand-in-records.md](../project/agent-stand-in-records.md)).

Done by an agent acting as the reviewing pathologist, against the classes the typers produce (PanNuke's neoplastic, inflammatory, connective, dead and epithelial, folded into the kit's Tumor, Stroma, Immune and Other) and the terms a surgical pathologist uses at the microscope.

| Item | Before | After | Why |
|---|---|---|---|
| Zone torn between two types | "tumor or immune" | "Tumor or immune", the more common type first | Reads as the real differential, for example large activated lymphocytes against tumor cells in a node. Kept |
| Zone where the second typer disagrees | "second typer disagrees" | "Models disagree" | "Typer" is our word, not a pathologist's |
| Zone of doubtful detections | "maybe not cells" | "Possibly not cells" | Plainer and less casual |
| Tumor hint | none | neoplastic cells, mitoses included | A mitosis in the tumor is tumor, not Other |
| Stroma hint | none | fibroblasts, endothelial and smooth muscle cells | The connective class of the typers |
| Immune hint | lymphocytes, plasma cells, histiocytes | lymphocytes, plasma cells, histiocytes, neutrophils and eosinophils | The typers' inflammatory class holds granulocytes too, and without them a reviewer would file a neutrophil under Other |
| Other hint | none | benign epithelium, necrotic and apoptotic cells, and any other cell | Benign epithelium is not tumor and has no class of its own here |
| Not a cell hint | none | debris, pigment, red blood cells, folds or blur | The usual false detections. Red blood cells have no nucleus, so they are not a nucleated cell |

"Immune" stays as the button name instead of "Inflammatory", because it is shorter and matches the immune cell counts researchers report, and the hint lists the cells. US spelling "tumor" stays, as everywhere in the app. REVIEW-018 (zones) and REVIEW-019 (type bar) now carry this wording. Nothing is built with the old wording yet.
