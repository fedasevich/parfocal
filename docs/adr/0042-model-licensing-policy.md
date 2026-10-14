# 0042. Model licensing policy: Parfocal is commercial, and the registry blocks any model whose licences are not confirmed

- Date: 2026-10-14
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: STACK-031 (model licensing policy), AIP-002 (model registry), AIP-000 (AI platform research check), AIP-001 (model artifact storage), AIP-003 (tiers Best, Good, Fast), AIP-008 (job model and API), AINUC-000 (nuclei detector and typer research check), AISEG-000 (interactive segmentation research check), AITUM-000 (tumor map research check), MLEVAL-000 (evaluation research check), MLEVAL-001 (dataset registry and loaders)

## Context

STACK-031 (model licensing policy) asks whether the product is commercial, then which models may run in which tenant type. The [decisions baseline](../BACKLOG.md) and risk R1 in [risks](../project/risks.md) record the problem. The HoVer-NeXt and VISTA-2D weights are CC BY-NC-SA 4.0, and calibration fitted on PanNuke may be non-commercial too. Its done-when line asks for a licence matrix (model, weights licence, data licence, allowed tenant types) and a model registry (AIP-002) that enforces it. The registry is a later task, so this record holds the matrix and the rule the registry must apply.

Tenants come in three kinds, `diagnostic`, `research` and `second-opinion`, fixed by [ADR 0024](0024-workspaces-are-tenants.md). The only plan is `pilot`. The cross-cutting criteria of the research checks already say every choice needs a "licence compatible with commercial SaaS".

How the facts below were gathered. Every licence was read on 2026-10-14 from the model card, the repository or the dataset page that the row links to. The pages were read through a fetch tool that returns the page text, so the wording quoted here is what the tool returned. The repository licence says nothing about the weights, which is why the weights are read from the hosting page (Zenodo, Hugging Face, the model zoo) when one exists. Where a primary page did not state a licence, or could not be opened, the cell says `TODO` and the registry treats it as blocked. Nothing here is legal advice, and `TODO (counsel)` marks the questions a lawyer must answer.

What the POC did. [POC doc 17](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/17-monai-models.md) and [doc 29](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/29-better-typer-and-second-opinions.md) noted that VISTA-2D and HoVer-NeXt weights rule out commercial use. The POC also fitted calibration temperatures on PanNuke fold 1 and vendored a small copy of the HoVer-NeXt decoder, and the HoVer-NeXt code is GPL-3.0. None of that carries over.

## Options considered

1. Treat pilots as non-commercial, and allow non-commercial models in research tenants. This keeps HoVer-NeXt and VISTA-2D usable now. But the operator is a company that hosts the model for outside users and may charge later, so a "non-commercial" licence would be breached in the research tenant as well. A tenant kind is not a licence boundary.
2. Treat the product as commercial from the first pilot, and block every model whose weights or training data are not confirmed as usable commercially. This costs the best nucleus typers today and keeps the platform clean for the first tenant with real data.
3. Decide per model by asking each author for a commercial licence first. This is still needed for the models that matter, but as a task inside the AI research checks. It cannot be the policy, because answers take weeks and the registry needs a rule today.

## Decision

Option 2. Parfocal is a commercial service from the first pilot tenant, and the licence of a model is judged on that basis in every tenant kind and every hosted environment.

### Classes

Each licence in the matrix gets one class.

- `permitted` means the licence allows commercial use of the weights as hosted by us, such as Apache-2.0, MIT, BSD, CC BY or CC0. A custom vendor licence is `permitted` only after the owner has recorded a sign-off in the registry.
- `restricted` means the licence forbids commercial use or hosted use. Examples are any NC or ND Creative Commons licence, a research-only clause, a Commons Clause, and "deployed use is out of scope".
- `unconfirmed` means no primary source states the licence, the page could not be read, or two primary sources disagree.
- `own` applies only to data. It means the weights licensor created or owns the training data, so the weights licence is the only term that applies.

### Rules the registry applies

1. A model version is allowed in a tenant kind only if its weights class is `permitted` and every training or calibration dataset class is `permitted`, `own`, or carries a review reference (an ADR or a written legal opinion) that accepts it.
2. A model with weights class `restricted` or `unconfirmed`, or with any dataset class `restricted` or `unconfirmed` and no review reference, has an empty set of allowed tenant kinds. It can be registered as `candidate` and can never become `validated`.
3. When the rule above passes, the allowed kinds start as all three. A model whose terms prohibit clinical or diagnostic use loses `diagnostic` and `second-opinion` and keeps `research`. A model whose terms are silent on clinical use keeps all three, and AIP-005 (validation mapping per site and specimen) decides where it may run.
4. The set of allowed kinds is computed from the stored licence fields and is never typed in by hand. A person may only narrow it.
5. The check runs at three points. Registration refuses to set a kind outside the computed set. Tier mapping (AIP-003, tiers Best, Good, Fast) refuses to map a model to a tier of a tenant whose kind is not allowed. Job creation (AIP-008, job model and API) refuses a job with the error `model-not-allowed-for-tenant` using the kind of the job's tenant, read inside the request's transaction. Model artifact storage (AIP-001) refuses to store an artifact that has no registry row.
6. There is no per-tenant or per-plan override. A customer-supplied model is out of scope for now and would need its own record (`TODO`).
7. A change to any licence field creates a new registry version and an audit log entry ([ADR 0027](0027-audit-log-hash-chain-in-postgres.md)). Licences are re-read at every new model version and at every research check that picks models.
8. Restricted models and datasets may be run offline by the team to produce comparison numbers (MLEVAL-001, dataset registry and loaders, already treats MoNuSeg and PanNuke as reference only). They are never loaded in a hosted environment that serves outside users, never used as a teacher or a source of pseudo-labels for a model we ship, and never used to train or fit anything we ship. This includes calibration temperatures, which must be fitted on `permitted` data only. Whether offline evaluation on a non-commercial dataset by a company is itself allowed is `TODO (counsel)`.
9. No code is copied from a GPL or Commons Clause repository into this repository. Package licence scanning (FOUND-014, dependency and licence scanning) is on hold and does not cover model weights, so the registry is the only weights control.

### Licence matrix: models

Tenant columns say whether the registry would allow the row today under the rules above. A dash means not allowed. Rows with `TODO` stay closed until the cell is filled from a primary source.

| Model | Weights licence | Training data and its licence | Diagnostic | Research | Second-opinion |
|---|---|---|---|---|---|
| HoVer-NeXt, PanNuke weights | CC BY-NC-SA 4.0 on [Zenodo 10635618](https://zenodo.org/records/10635618). Code is GPL-3.0 per the [repository](https://github.com/digitalpathologybern/hover_next_inference) | PanNuke, CC BY-NC-SA 4.0, commercial use not allowed ([PanNuke page](https://warwick.ac.uk/fac/cross_fac/tia/data/pannuke)) | - | - | - |
| HoVer-NeXt, Lizard weights | CC BY-NC-SA 4.0 on the same record | Lizard, CC BY-NC-SA 4.0 per the [HoVer-NeXt datasets record](https://zenodo.org/records/10636591). The Warwick source page needs a login, so the primary page is `TODO` | - | - | - |
| VISTA-2D | CC BY-NC-SA 4.0, stated in the [model zoo README](https://github.com/Project-MONAI/model-zoo/tree/dev/models/vista2d) | Mixed, listed in [data_license.txt](https://github.com/Project-MONAI/model-zoo/blob/dev/models/vista2d/docs/data_license.txt). Cellpose, TissueNet, Omnipose, NIPS Cell Segmentation and LiveCell are non-commercial. Kaggle Nuclei is CC BY 4.0 and Deepbacs is CC0 | - | - | - |
| PathoSAM (`vit_b`, `vit_l`, `vit_h` histopathology) | Code MIT per the [patho-sam repository](https://github.com/computational-cell-analytics/patho-sam). Weights are downloaded from an ownCloud address named in the [micro-sam source](https://github.com/computational-cell-analytics/micro-sam/blob/main/micro_sam/util.py). No weights licence found, so `TODO` | The [paper](https://arxiv.org/abs/2502.00408) trains on a 15-dataset collection (Table 1) that includes PanNuke, Lizard and MoNuSeg, which are non-commercial. Other licences `TODO` | - | - | - |
| SAM ViT-B, L, H (Meta) | Apache-2.0 for code and checkpoints per the [repository](https://github.com/facebookresearch/segment-anything) and the [model card](https://huggingface.co/facebook/sam-vit-base) | SA-1B, owned by Meta and offered under the SA-1B Dataset Research License ("Research purposes only" on [Meta's page](https://ai.meta.com/datasets/segment-anything/)). Class `own` | yes | yes | yes |
| SAM 2 (Meta) | Apache-2.0 for checkpoints, demo and training code per the [repository](https://github.com/facebookresearch/sam2) | SA-V, CC BY 4.0 per the [SA-V README](https://github.com/facebookresearch/sam2/blob/main/sav_dataset/README.md). Class `permitted` | yes | yes | yes |
| SAM 3 (Meta) | SAM License dated 2025-11-19, a custom licence ([text](https://github.com/facebookresearch/sam3/blob/main/LICENSE)). It grants a royalty-free limited licence, does not mention commercial use, and bars uses banned by trade controls. Access is gated on [Hugging Face](https://huggingface.co/facebook/sam3), where the licence shows as "other". Owner sign-off `TODO` | Described as an automatically annotated set of over 4 million concepts, with no sources or licence stated in the [README](https://github.com/facebookresearch/sam3). `TODO` | - | - | - |
| SlimSAM-77 (ONNX by Xenova) | Apache-2.0 on the [model card](https://huggingface.co/Xenova/slimsam-77-uniform). The [SlimSAM repository](https://github.com/czg1225/SlimSAM) is Apache-2.0 and states no checkpoint licence | Pruned and distilled with about 10k SA-1B images by third parties, so the SA-1B Research License applies to them. Review `TODO (counsel)` | - | - | - |
| MobileSAM | Code Apache-2.0 per the [repository](https://github.com/ChaoningZhang/MobileSAM). No checkpoint licence found, `TODO` | "100k datasets (1% of the original images)", source not named in the README. `TODO` | - | - | - |
| EdgeSAM | NTU S-Lab License 1.0, which allows non-commercial use only ([LICENSE](https://github.com/chongzhou96/EdgeSAM/blob/master/LICENSE)) | SA-1B subsets, third-party use under the SA-1B Research License | - | - | - |
| EfficientViT-SAM | Code Apache-2.0 per the [repository](https://github.com/mit-han-lab/efficientvit). The [EfficientViT-SAM README](https://github.com/mit-han-lab/efficientvit/blob/master/applications/efficientvit_sam/README.md) states no checkpoint licence, `TODO` | SA-1B, COCO2017 and LVIS, third-party use. Review `TODO (counsel)` | - | - | - |
| NuClick (MONAI bundle `pathology_nuclick_annotation`) | Apache-2.0 for the bundle per its [README](https://github.com/Project-MONAI/model-zoo/blob/dev/models/pathology_nuclick_annotation/docs/README.md). The [model zoo](https://github.com/Project-MONAI/model-zoo) says each bundle has its own terms | CoNSeP, licence `TODO` | - | - | - |
| HoVer-Net (MONAI bundle `pathology_nuclei_segmentation_classification`) | Apache-2.0 for the bundle per its [README](https://github.com/Project-MONAI/model-zoo/blob/dev/models/pathology_nuclei_segmentation_classification/docs/README.md), which adds that the original HoVer-Net weights are "for non-commercial use" | CoNSeP, licence `TODO` | - | - | - |
| Nuclei classification (MONAI bundle `pathology_nuclei_classification`) | Apache-2.0 for the bundle per its [README](https://github.com/Project-MONAI/model-zoo/blob/dev/models/pathology_nuclei_classification/docs/README.md) | CoNSeP, licence `TODO` | - | - | - |
| Tumor detection ResNet18 (MONAI bundle `pathology_tumor_detection`) | Apache-2.0 for the bundle per its [README](https://github.com/Project-MONAI/model-zoo/blob/dev/models/pathology_tumor_detection/docs/README.md), which says the ImageNet weights it starts from are "for non-commercial use" | CAMELYON16. Two primary pages disagree, CC0 on the [CAMELYON data page](https://camelyon17.grand-challenge.org/Data/) and CC BY-NC-ND 4.0 on the [download page](https://camelyon17.grand-challenge.org/Download). Class `unconfirmed` | - | - | - |
| CellViT (SAM-H, 256) | Code is Apache-2.0 with the Commons Clause, which withholds the right to sell the software or provide it to third parties for a fee ([LICENSE](https://raw.githubusercontent.com/TIO-IKIM/CellViT/main/LICENSE), [README](https://github.com/TIO-IKIM/CellViT)). No checkpoint licence found | PanNuke, non-commercial. Others `TODO` | - | - | - |
| CellViT++ | HIPT-derived and original code are Apache-2.0 with the Commons Clause and a bar on commercial exploitation ([LICENSE](https://raw.githubusercontent.com/TIO-IKIM/CellViT-plus-plus/main/LICENSE)). The [README](https://github.com/TIO-IKIM/CellViT-plus-plus) says some checkpoints cannot be shared "due to their license" | Datasets `TODO` | - | - | - |
| NuLite | Code is Apache-2.0 with the Commons Clause per the [README](https://github.com/CosmoIknosLab/NuLite), which also says the derived weights share the PanNuke licence | PanNuke, CC BY-NC-SA 4.0 | - | - | - |
| InstanSeg | Code Apache-2.0 per the [repository](https://github.com/instanseg/instanseg). No weights licence found, `TODO` | Training datasets per model `TODO`. The README says the authors plan models "trained on public datasets" and ask for CC0 or CC-BY datasets | - | - | - |
| StarDist `2D_versatile_he` | Code BSD-3-Clause per the [repository](https://github.com/stardist/stardist). No weights licence found, `TODO` | MoNuSeg, CC BY-NC-SA 4.0 per its [data page](https://monuseg.grand-challenge.org/Data/), and TNBC, CC BY 4.0 per [Zenodo 2579118](https://zenodo.org/records/2579118) | - | - | - |
| UNI2-h | CC BY-NC-ND 4.0, non-commercial research only ([model card](https://huggingface.co/MahmoodLab/UNI2-h)) | Over 200 million tiles from Mass General Brigham slides. Class `own` | - | - | - |
| Virchow2 | CC BY-NC-ND 4.0, and the terms prohibit use to diagnose, treat or prevent disease ([model card](https://huggingface.co/paige-ai/Virchow2)) | 3.1 million slides from Memorial Sloan Kettering. Class `own` | - | - | - |
| H-optimus-1 | CC BY-NC-ND 4.0 ([model card](https://huggingface.co/bioptimus/H-optimus-1)). Commercial licences by contacting Bioptimus | Proprietary, over a million slides. Class `own` | - | - | - |
| H-optimus-0 | Apache-2.0 ([model card](https://huggingface.co/bioptimus/H-optimus-0)). Access needs sharing contact details. The card says the model is not regulator reviewed | Proprietary collection of more than 500,000 H&E slides. Class `own` | yes | yes | yes |
| Prov-GigaPath | Licence field Apache-2.0, but the [model card](https://huggingface.co/prov-gigapath/prov-gigapath) says "Any deployed use case of the model, commercial or otherwise, is out of scope" and limits use to research. Class `restricted` | Pretraining data not stated on the card. `TODO` | - | - | - |

### Licence matrix: datasets

This table feeds the data columns above and the dataset rules in AIP-002 (model registry), MLEVAL-000 (evaluation research check) and MLEVAL-001 (dataset registry and loaders).

| Dataset | Licence | Class | Source |
|---|---|---|---|
| PanNuke | CC BY-NC-SA 4.0, "Commercial uses are not allowed" | restricted | [Warwick page](https://warwick.ac.uk/fac/cross_fac/tia/data/pannuke) |
| Lizard | CC BY-NC-SA 4.0 | restricted | [Zenodo 10636591](https://zenodo.org/records/10636591), secondary. Primary page needs a login, `TODO` |
| MoNuSeg | CC BY-NC-SA 4.0 | restricted | [Challenge data page](https://monuseg.grand-challenge.org/Data/) |
| CoNSeP | Not stated on the pages reachable without a login | unconfirmed | `TODO`, open the [HoVer-Net data page](https://warwick.ac.uk/fac/cross_fac/tia/data/hovernet) with a Warwick account or ask the authors |
| CAMELYON16 | CC0 on one page and CC BY-NC-ND 4.0 on another | unconfirmed | [Data page](https://camelyon17.grand-challenge.org/Data/) and [download page](https://camelyon17.grand-challenge.org/Download). `TODO` ask the organisers or check the GigaScience record |
| TNBC | CC BY 4.0 | permitted | [Zenodo 2579118](https://zenodo.org/records/2579118) |
| NuInsSeg | CC BY 4.0 | permitted | [Zenodo 10518968](https://zenodo.org/records/10518968) |
| CryoNuSeg | Not stated. The [repository](https://github.com/masih4/CryoNuSeg) is MIT, which covers code only | unconfirmed | `TODO`, read the Kaggle page |
| SA-1B | SA-1B Dataset Research License, "Research purposes only" | restricted for third parties | [Meta dataset page](https://ai.meta.com/datasets/segment-anything/) |
| SA-V | CC BY 4.0 | permitted | [SA-V README](https://github.com/facebookresearch/sam2/blob/main/sav_dataset/README.md) |

## Consequences

- No nucleus detector or typer is allowed today. HoVer-NeXt, VISTA-2D, CellViT, CellViT++ and NuLite are blocked by their weights and by PanNuke. PathoSAM, the MONAI bundles, InstanSeg and StarDist are blocked until their `TODO` cells are filled. Risk R1 in [risks](../project/risks.md) stays open and its mitigation grows.
- The only rows that pass are SAM ViT, SAM 2 and H-optimus-0, and none of them is validated for pathology yet. AIP-005 (validation mapping per site and specimen) still decides where each may run.
- The mitigations for the nucleus typer are, in order. First, fill the `TODO` cells for InstanSeg, PathoSAM and the MONAI bundles. Second, ask the HoVer-NeXt, PanNuke and CellViT++ authors for commercial licences. Third, train a typer on `permitted` data only (TNBC and NuInsSeg are CC BY 4.0, and CAMELYON16, CoNSeP and CryoNuSeg wait on their `TODO` cells). The research checks AINUC-000 (nuclei), AISEG-000 (interactive segmentation), AITUM-000 (tumor map) and AIP-000 (AI platform) must start from this matrix and may only add rows or change a class with a source.
- Calibration temperatures must be refitted on `permitted` data before any typer ships. The POC's PanNuke-fitted values are reference only.
- The browser fast tier (AISEG-013, fast tier in the browser without a GPU) cannot rely on InstanSeg or StarDist until their weights and data are confirmed.
- AIP-002 (model registry) gets the fields and the rules above. AIP-008 (job model and API) must call the same check. Edits to the backlog are listed in the log entry.
- Open questions for counsel: whether offline evaluation on a non-commercial dataset by a company is allowed, whether weights trained on non-commercial data inherit the dataset licence, and whether a Commons Clause bars hosting for outside users. The registry assumes the strict answer to all three until counsel says otherwise.
- Open source checks: PathoSAM weights licence, SAM 3 sign-off, MobileSAM, EfficientViT-SAM, InstanSeg and StarDist weights licences, CoNSeP, CryoNuSeg and CAMELYON16 dataset licences, and the primary Lizard page.
