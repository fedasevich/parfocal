# XXXX. The MONAI CAMELYON ResNet18 stays the v1 tumor model, and a foundation-model probe replaces it only after it passes the same test-slide evaluation

- Date: 2026-11-16
- Status: Proposed
- Deciders: Yurii Fedas, proposed by the agent doing AITUM-000 (tumor map research check)
- Backlog: AITUM-000. Confirms the tumor rows of [ADR 0202](0202-v1-model-line-up-per-tier.md) (v1 model line-up per tier). Feeds MLEVAL-005 (tumor map evaluation), AITUM-001 (tumor map job), AITUM-003 (areas from the tumor map) and STACK-031 (model licensing policy, on hold)

## Context

AITUM-000 asks to compare the MONAI `pathology_tumor_detection` ResNet18 with linear probes on foundation models (UNI2, Virchow2, H-optimus and Prov-GigaPath) on CAMELYON16 test slides, under the licence policy. POC [doc 20](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/20-review-gaps-and-sota.md) section 2.6 (the tumour map) claims probes beat the CNN "by a wide margin". It cites no number for that, so this record does not repeat it as a finding.

The licence policy is not a filter today. [ADR 0042](0042-model-licensing-policy.md) (model licensing policy) is rejected, STACK-031 is on hold, and ADR 0202 records licences without enforcing them.

Three kinds of evidence appear below and are kept apart: measured here, measured by the POC, and published. Every foundation model's files on Hugging Face sit behind an access form, and agents have no sign-in, so none was downloaded and no probe was trained. That leaves the probe that ADR 0202 expected this task to measure, starting with H-optimus-0, and its peak memory on an L4, unmeasured.

The metrics do not line up. The bundle reports lesion-level FROC. Foundation-model papers report slide-level accuracy or AUC from attention MIL, or patch-level scores on PCam, a patch set cut from CAMELYON16. No source read gives a lesion-level FROC for a foundation model, so no cell below compares across columns.

## Evidence

### Measured here or in the POC

| Model | Slide | Number | Source |
|---|---|---|---|
| MONAI ResNet18 | `test_001`, test set | Patch AUC 0.9996 (0.9989 to 1.0000), sensitivity 0.960 and specificity 1.000 at 0.5, 200 interior tumour and 200 distant normal patches | [this check](../results/2026-11-16-monai-tumor-patches-on-test-001.md) |
| MONAI ResNet18 | `tumor_009`, training set | Whole slide, cells of 64 px: Dice 0.904, sensitivity 0.832, specificity 0.994 at 0.5, pixel AUC 0.937, 393 s on MPS | POC doc 17 (MONAI models) |
| MONAI ResNet18 | `tumor_009` | 7 areas for 6 deposits, largest 8.05 mm against 8.06 mm annotated | [areas port](../results/2026-11-02-tumor-areas-port-on-tumor-009.md) |
| Any foundation-model probe | | None | Unmeasured, weights behind a sign-in |

### Published, read on 2026-11-16

| Model | Number | Protocol | Source |
|---|---|---|---|
| MONAI ResNet18 0.6.4 | FROC 0.72 on the 48 annotated test slides, patch accuracy 0.90 on validation | Bundle's own claim | bundle `docs/README.md` and `configs/metadata.json` |
| Best CAMELYON16 entry, 2016 | Slide AUC 0.994 (0.983 to 0.999), FROC 0.807 (0.732 to 0.889) | Challenge test set, 129 slides | [Ehteshami Bejnordi et al., JAMA 2017](https://jamanetwork.com/journals/jama/fullarticle/2665774) |
| Pathologist without time limit | Slide AUC 0.966, lesion true positive fraction 72.4% at 0.0125 false positives per normal slide | Same | Same |
| UNI | Balanced accuracy 95.7% on CAMELYON16. The margins over ImageNet ResNet-50, CTransPath and REMEDIS are 23.1, 6.0 and 2.7 points | ABMIL on frozen features, slide level | [Chen et al., UNI](https://arxiv.org/html/2308.15474) |
| Virchow2, UNI, Prov-GigaPath, H-optimus-0 | PCam weighted F1 93.5, 93.5, 94.1 and 93.7 | Linear probe on frozen tile embeddings | [Virchow2 paper](https://arxiv.org/html/2408.00738), table 2 |
| PLUTO-4, LiteFM | No CAMELYON16 or PCam figure in the abstract, and no weight release stated | | [PLUTO-4](https://arxiv.org/abs/2511.02826), [LiteFM](https://arxiv.org/abs/2602.14010) |

A vendor table reported by search for H-optimus-1, UNI2-h, Virchow2 and H-optimus-0 on CAMELYON16 slide AUC could not be opened (404), so it gives no number here.

### Licence and access, read on Hugging Face on 2026-11-16

| Model | Size | Licence | Access | Fits ADR 0150 (T4 and L4 class cards) |
|---|---|---|---|---|
| MONAI ResNet18 | 44.8 MB weights | Bundle Apache-2.0, ImageNet start weights "for non-commercial use" in training only, CAMELYON16 CC0 per the bundle's `data_license.txt` | Public | Yes, POC runs it on a laptop GPU |
| H-optimus-0 | ViT-g, about 1.1B parameters, 224 px at 0.5 µm/px | Apache-2.0 | Form, shares the Hugging Face profile | `TODO`, peak memory unmeasured |
| UNI2-h | ViT-H/14, about 681M parameters | CC BY-NC-ND 4.0, non-commercial academic research | Form, institutional email required | `TODO` |
| Virchow2 | ViT-H/14, 632M parameters | CC BY-NC-ND 4.0, academic research, no diagnosis or clinical support | Form, institutional email required | `TODO` |
| Prov-GigaPath | Tile encoder size not stated on the card | Apache-2.0, but "any deployed use case" is out of scope | Form | `TODO` |

The Hugging Face rows supersede the "not re-read" cells of ADR 0202 for these models.

## Options considered

| Option | For | Against |
|---|---|---|
| A. Keep the MONAI ResNet18 as the Best tumor model, and let a probe replace it only after the evaluation below | Measured on a test slide, permissive bundle, tiny, fully convolutional, so a whole slide is one cheap pass | Older model, published FROC 0.72 against 0.807 for the best challenge entry |
| B. Switch now to an H-optimus-0 probe | Best permissive licence among the large models, strong published patch and slide numbers | Nothing measured here, needs a sign-in, a probe to train and an order of magnitude more compute per slide (doc 20) |
| C. Switch to a UNI2-h or Virchow2 probe | Top published rankings | Non-commercial, no-derivatives terms, Virchow2 bars clinical support, institutional email the owner may not have, nothing measured |

## Decision

Option A. The MONAI `pathology_tumor_detection` ResNet18 0.6.4 stays the v1 Best tumor model, Good and Fast stay empty, as in ADR 0202. No published number shows a foundation-model probe beating it on the lesion-level metric this product uses, and nothing else has been measured here.

A challenger, starting with an H-optimus-0 probe once decision XXX (whether to sign in for gated foundation models) allows it, replaces the ResNet18 only after passing this evaluation:

1. Training data. A linear probe (logistic regression) on frozen embeddings of CAMELYON16 training patches only, with the same patch lists as the bundle's `training.csv` and `validation.csv`. No test slide is used for training or tuning.
2. Test data. The CAMELYON16 test slides with reference annotations, at least three on demand for every change and all 48 before promotion. `test_001` is the first, and its patch check above is the baseline.
3. Metrics, through MLEVAL-005 (tumor map evaluation). Lesion-level FROC as the challenge defines it, slide-level AUC, Dice at 0.5 on 64 px cells, and per-deposit size error with stray areas from AITUM-003's `evaluate_areas`.
4. The gate. The challenger must beat the ResNet18 on FROC and not lose on Dice on the same slides, through the promotion gate of [ADR 0322](0322-the-promotion-gate-compares-with-a-reference-within-a-tolerance.md) (reference within a tolerance).
5. Cost. Peak GPU memory on an L4 at the shipped batch size within ADR 0150, and seconds per whole slide and per 8,192 px view, against the ResNet18's on the same card. Mapping at ingest must stay within the $30 a month budget.
6. Every number goes into a result file with the model, its weights checksum and its licence row.

## Consequences

- The catalogue, AITUM-001 and AITUM-003 keep building on the ResNet18. Nothing changes in code.
- MLEVAL-005 is the next task for the tumor map and should start with `test_001`, which is already cached.
- The licence cells for H-optimus-0, UNI2-h, Virchow2 and Prov-GigaPath are now read on Hugging Face. When STACK-031 reopens, H-optimus-0 is the only large candidate with a licence that allows deployed use.
- The probe and its memory stay `TODO` until the owner answers decision XXX.

## References

- [Patch check on test_001](../results/2026-11-16-monai-tumor-patches-on-test-001.md) and the script `workers/ml/spike/tumor_patch_check.py`
- POC docs 17 and 20, listed in [poc-reference.md](../project/poc-reference.md)
- Hugging Face model cards of [H-optimus-0](https://huggingface.co/bioptimus/H-optimus-0), [UNI2-h](https://huggingface.co/MahmoodLab/UNI2-h), [Virchow2](https://huggingface.co/paige-ai/Virchow2) and [Prov-GigaPath](https://huggingface.co/prov-gigapath/prov-gigapath), read 2026-11-16
