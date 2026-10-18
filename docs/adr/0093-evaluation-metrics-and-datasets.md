# 0093. Model evaluation uses PQ, AJI, mIoU, NoC, ECE and FROC on held-out sets kept outside the repository, each used within its licence

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: MLEVAL-000, MLEVAL-001 to MLEVAL-008, AINUC-000, AILEARN-000, SEC-021

## Context

MLEVAL-000 asks to confirm the metrics and datasets and to record each dataset's licence. The POC measured nucleus segmentation with PQ on TNBC, CryoNuSeg and NuInsSeg as held-out sets, because PathoSAM was trained on MoNuSeg and PanNuke (POC [doc 26](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/26-held-out-benchmarks.md)), typing and calibration on PanNuke fold 3 (docs 28, 29 and 33) and the tumor map on CAMELYON16 (doc 36). The geometric scorer now reproduces the POC's numbers ([result](../results/2026-10-18-geometric-scorer-reproduction.md)). The owner said on 2026-10-15 that Parfocal will not really be commercial ([risks](../project/risks.md) R1), and [ADR 0042](0042-model-licensing-policy.md), a commercial licensing policy, was rejected.

## Options considered

1. Commit small dataset subsets as test fixtures so CI can score models. Convenient, but it redistributes data under non-commercial and share-alike licences inside a private repository, and the subsets would not be the published splits.
2. Keep every dataset outside the repository, fetched by the registry into a local cache with its checksum, licence and citation recorded, and run the scoring tests where the data is present. Tests with tiny synthetic data run everywhere.

## Decision

Option 2.

Metrics:

| Metric | Used for | Task |
|---|---|---|
| PQ (with its SQ and detection F1) and AJI | Nucleus instance segmentation, with per-organ or per-tissue breakdowns | MLEVAL-002 |
| mIoU per object and NoC at 85 and 90% IoU | Interactive segmentation (clicks, boxes, refinement) | MLEVAL-003 |
| Accuracy, balanced accuracy, confusion matrix, ECE and band accuracy | Nucleus typing and calibration | MLEVAL-004 |
| FROC and Dice | Tumor maps on whole slides | MLEVAL-005 |

Datasets, as found on 2026-10-18:

| Dataset | Role | Licence | Source |
|---|---|---|---|
| MoNuSeg | Reference only, in PathoSAM's training set | CC BY-NC-SA 4.0 | [challenge data page](https://monuseg.grand-challenge.org/Data/) |
| PanNuke | Reference for segmentation, folds 1 and 3 for calibration and typing | CC BY-NC-SA 4.0 | [Warwick TIA page](https://warwick.ac.uk/fac/cross_fac/tia/data/pannuke) |
| TNBC (Naylor et al., v1.1) | Held-out segmentation | CC BY 4.0 | [Zenodo 2579118](https://zenodo.org/records/2579118) |
| NuInsSeg | Held-out segmentation, per organ | CC BY 4.0 | [Zenodo 10518968](https://zenodo.org/records/10518968) |
| CryoNuSeg | Held-out segmentation on frozen sections | TODO: not stated on the [GitHub repository](https://github.com/masih4/CryoNuSeg) (its code is MIT), and the Kaggle page could not be read | Kaggle |
| Lizard | Native 20× colon nuclei with six classes | CC BY-NC-SA 4.0 according to a [derived Zenodo record](https://zenodo.org/records/10636591). TODO: confirm on the Warwick page, which needs a sign-in | CoNIC challenge |
| CAMELYON16 test slides | Tumor maps | CC0 on the [challenge data page](https://camelyon17.grand-challenge.org/Data/) and the [AWS Open Data registry](https://registry.opendata.aws/camelyon/). One page of the same challenge site is reported to say CC BY-NC-ND 4.0. TODO: settle with the organisers before redistributing anything derived | Radboud UMC |

Allowed use:

- Every dataset may be used to evaluate models inside Parfocal and to publish the resulting numbers with the dataset's citation. None is committed to this repository. Like the OpenSlide and CAMELYON16 slides in `packages/test-fixtures`, they are downloaded into a cache and checked against their checksums, and only tiny synthetic files are committed.
- Data under NC or SA terms (MoNuSeg, PanNuke, Lizard) is not redistributed, and neither are weights or calibrations derived from it outside research use. TODO: the owner confirms before any model trained or calibrated on these ships to a paying tenant (R1).
- CryoNuSeg is used for evaluation only until its licence is confirmed.

## Consequences

- MLEVAL-001 (dataset registry and loaders) records each entry's licence, source, citation and checksum from this table, and its tests run where the data is cached.
- MLEVAL-002 to MLEVAL-005 use the metrics above. The POC fixture paths in `test_scoring.py` move to the registry with MLEVAL-001.
- SEC-021 (GDPR documentation) needs nothing from this, because none of these datasets holds personal data about Parfocal's users or patients.
