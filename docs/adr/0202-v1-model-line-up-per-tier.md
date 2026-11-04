# 0202. The v1 model line-up is PathoSAM AIS and HoVer-NeXt for nuclei, the MONAI CAMELYON model for tumor, and PathoSAM for interactive outlines, all non-commercial or unconfirmed

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas (accepted 2026-11-04 as the v1 starting line-up), proposed by the agent doing AIP-000 (AI platform research check)
- Backlog: AIP-000 (AI platform research check). Confirms STACK-022 (background jobs and durable workflows), STACK-027 (GPU inference serving) and STACK-031 (model licensing policy, on hold). Feeds AINUC-000 (nuclei research check), AISEG-000 (interactive segmentation research check), AITUM-000 (tumor map research check), AIP-002 (model registry) and the tier defaults of [ADR 0159](0159-tier-mapping-per-workspace.md) (tier mapping per workspace)

## Context

AIP-000 asks for a re-check of the ranked list in [POC doc 20](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/20-review-gaps-and-sota.md) (review of gaps and the state of the art, September 2026) against the current literature, and an ADR that lists the v1 models per tier with their licence status.

Doc 20 ranked eight findings. The POC itself has since closed the three that pick models.

- Finding 1, the PathoSAM automatic instance segmentation (AIS) decoder. [POC doc 26](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/26-held-out-benchmarks.md) (held-out benchmarks) exported it and runs it in the browser and on the server. On three held-out sets (TNBC, CryoNuSeg, NuInsSeg) it scores a mean PQ of 0.596 and F1 of 0.740, against 0.211 and 0.289 for HoVer-Net, which misses 43% of nuclei on TNBC and 83% on CryoNuSeg.
- Finding 2, the typer. [POC doc 29](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/29-better-typer-and-second-opinions.md) (PanNuke-trained typer) replaced the CoNSeP classifier with HoVer-NeXt, which types held-out PanNuke fold 3 nuclei 83.0% right (81.7% balanced) against 48.9% for the old classifier, and is nearly calibrated after a temperature of 1.42.
- Finding 4, contamination. Doc 26 moved every accuracy figure to sets outside PathoSAM's training pool.

Three rules bound the choice. [ADR 0150](0150-gpu-serving-on-t4-and-l4-class-cards.md) (GPU serving) allows only T4 and L4 class cards and 16 or 24 GB at the shipped batch size. [ADR 0159](0159-tier-mapping-per-workspace.md) keeps Fast empty on the server because Fast models run in the browser. [ADR 0042](0042-model-licensing-policy.md) (model licensing policy) is rejected because the owner said on 2026-10-15 that Parfocal will not really be commercial, so licence status is recorded here and is not enforced.

How the literature was re-checked on 2026-11-03. Web searches covered nucleus segmentation and typing, pathology foundation models and promptable segmentation. GitHub pages were read directly. Hugging Face, Zenodo and arXiv could not be reached from this session (the host did not resolve), so every licence cell that lives on those hosts is carried over from ADR 0042, which read them on 2026-10-14, and is marked "not re-read". Papers seen only through search snippets are marked as such and give no numbers here.

## What the re-check found

### Nucleus segmentation and typing

- The PathoSAM paper ([arXiv 2502.00408](https://arxiv.org/abs/2502.00408), MIDL 2025) still presents PathoSAM as the state of the art for automatic and interactive nucleus instance segmentation, and says its semantic (typing) head does not beat CellViT. That matches the POC split of PathoSAM for outlines and a separate typer.
- CellViT reports a PanNuke mPQ of 0.50 and detection F1 of 0.83 ([CellViT](https://www.academia.edu/112126015/CellViT_Vision_Transformers_for_Precise_Cell_Segmentation_and_Classification)). The CellViT++ README still says some checkpoints "cannot be shared due to their license", and its code carries the Commons Clause per ADR 0042.
- Newer papers found only as search snippets: NucShare ([arXiv 2609.35203](https://arxiv.org/html/2609.35203), October 2026, a light shared-decoder model compared with HoVer-Net, CellViT-H and Mask R-CNN), SAFViT ([arXiv 2607.27835](https://arxiv.org/pdf/2607.27835)) and CellNuc-DETR ([arXiv 2502.06307](https://arxiv.org/html/2502.06307v1)). None was shown to beat HoVer-NeXt on held-out sets, and their weights and licences are unknown. AINUC-000 reads them in full.
- HoVer-NeXt code is still GPL-3.0 per its [repository](https://github.com/digitalpathologybern/hover_next_inference), which says the weights are on Zenodo and says nothing more on their licence.
- InstanSeg code is Apache-2.0. Its [releases page](https://github.com/instanseg/instanseg/releases) says "Refer to the README in each model folder for licenses and training datasets", and no page reached states the `brightfield_nuclei` weights licence or training sets. Still `TODO`.

Nothing found displaces PathoSAM AIS for outlines or HoVer-NeXt typing for v1.

### Pathology foundation models

- The independent PathBench comparison of 19 models over 64 tasks ranks Virchow2 and H-optimus-1 best on average ([review](https://www.themoonlight.io/review/pathbench-a-comprehensive-comparison-benchmark-for-pathology-foundation-models-towards-precision-oncology)). Bioptimus reports H-optimus-1 first, then Virchow2, H-optimus-0 and UNI2, a vendor figure ([Bioptimus benchmarks](https://docs.bioptimus.com/documentation/models/benchmarks.md)).
- Newer entries: PLUTO-4 ([arXiv 2511.02826](https://arxiv.org/html/2511.02826v1)) and LiteFM, a model distilled from Virchow2, H-optimus-1 and UNI2 ([arXiv 2602.14010](https://arxiv.org/pdf/2602.14010)). Their weights and licences were not found.
- Of the strong models, only H-optimus-0 has a permissive licence (Apache-2.0 per ADR 0042 and the [Bioptimus page](https://www.bioptimus.com/h-optimus), not re-read on Hugging Face). UNI2-h, Virchow2 and H-optimus-1 are CC BY-NC-ND 4.0 and Prov-GigaPath excludes deployed use, per ADR 0042, not re-read.

No foundation model enters v1 as a shipped tier. A linear probe over frozen embeddings is the upgrade path for the tumor map, and AITUM-000 measures it, starting with H-optimus-0. Its peak memory on an L4 is `TODO` and decides whether it fits ADR 0150.

### Promptable segmentation

- SAM 3 shipped in November 2025 under the custom SAM License, and SAM 3.1 ("Object Multiplex") on 2026-03-27 per the [SAM 3 repository](https://github.com/facebookresearch/sam3).
- "Is SAM3 ready for pathology segmentation?" ([arXiv 2604.18225](https://arxiv.org/html/2604.18225), v3 May 2026) concludes it is not a drop-in solution. Per secondary summaries, text prompts reach 6.22% mIoU on PanNuke, box prompts beat point prompts, and few-shot gains are fragile to prompt noise. These numbers were not checked against the paper.
- So PathoSAM stays the interactive model, SAM 2 Hiera-L stays a server option for boxes (doc 26 measured an exact box at 0.797 against 0.805 for PathoSAM), and SAM 3 stays an exemplar spike in AISEG-014 (find more like these).

## Options considered

1. Keep the POC's closing line-up: PathoSAM AIS for outlines, HoVer-NeXt for types, the MONAI CAMELYON ResNet18 for tumor, PathoSAM ViT-B and ViT-L for interactive work. All are measured in the POC on held-out sets, and all fit T4 or L4 class memory on the POC's evidence. Most of the weights are non-commercial or unconfirmed.
2. Pick only models whose weights and data are confirmed permissive: SAM ViT, SAM 2 and H-optimus-0. This leaves no nucleus detector or typer and no measured tumor model, which is the outcome ADR 0042 recorded and the owner set aside.
3. Wait for AINUC-000, AISEG-000 and AITUM-000 to measure newer models first. Their numbers are needed anyway, but the tier defaults and the registry need a starting line-up now.

## Decision

Option 1, as the v1 starting line-up. The task research checks may replace any row with MLEVAL numbers, and must record why.

| Task | Tier | v1 model | Runs on | Licence status |
| --- | --- | --- | --- | --- |
| Outline (detector) | Best | PathoSAM ViT-L encoder with its AIS decoder, seeded watershed | Server, L4 | Code MIT. Weights licence `TODO`, not stated on the repository. Trained on data that includes PanNuke, Lizard and MoNuSeg, which are CC BY-NC-SA 4.0. Non-commercial in practice |
| Outline (detector) | Good | PathoSAM ViT-B with its AIS decoder (the model doc 26 measured) | Server, T4 | Same as above |
| Outline (detector) | Fast | PathoSAM ViT-B AIS in the browser on WebGPU. Without WebGPU, AISEG-013 decides between InstanSeg and StarDist or defers | Browser | PathoSAM as above. InstanSeg code Apache-2.0, weights and training data `TODO` |
| Typer | Best | HoVer-NeXt, PanNuke weights, 8 views averaged | Server, L4 | Weights CC BY-NC-SA 4.0 (Zenodo 10635618, not re-read). Code GPL-3.0, confirmed 2026-11-03, so no code is copied into this repository. PanNuke CC BY-NC-SA 4.0 |
| Typer | Good | HoVer-NeXt, PanNuke weights, one view | Server, T4 | Same as above |
| Typer | Fast | None in v1 | | |
| Tumor | Best | MONAI `pathology_tumor_detection` ResNet18 (the catalogue's `camelyon-tumor`) | Server, T4 | Bundle Apache-2.0, ImageNet start weights "for non-commercial use", CAMELYON16 licence unconfirmed (two pages disagree). Not re-read |
| Tumor | Good, Fast | None in v1. Candidate for Best: H-optimus-0 linear probe, after AITUM-000 | | H-optimus-0 Apache-2.0, not re-read |
| Interactive click and box | Best | PathoSAM ViT-L embedding from the server, decoder in the browser | Server T4, then browser | As PathoSAM above |
| Interactive click and box | Good | PathoSAM ViT-B, encoder in the browser on WebGPU, or on the server T4 when WebGPU is missing | Browser or server T4 | As PathoSAM above |
| Interactive click and box | Fast | None in v1, see AISEG-013 | | |

Rules that follow.

1. Calibration temperatures, including HoVer-NeXt's 1.42, are POC reference values until AINUC-006 (calibration) refits them on the chosen weights.
2. HoVer-Net is not a v1 tier. Doc 26 shows it misses most nuclei on held-out sets, and doc 29 shows it is not worth running as a second detector.
3. Every v1 row records its peak GPU memory on its card in its first result file, as ADR 0150 asks.

### Confirmations

- STACK-022 holds. AI batch work runs as model runs that are engine jobs per slide ([ADR 0123](0123-model-runs-are-engine-jobs-per-slide.md)) on the Postgres job, step and tile tables of [ADR 0044](0044-background-jobs-and-workflows.md). Doc 20's demand that a whole-slide job survives a restart is what the tile checkpoints give. Nothing in the line-up needs an always-on worker.
- STACK-027 holds. Every model above is plain PyTorch or ONNX in a Modal function per family on a T4 or L4, per ADR 0150. The heaviest rows are the ViT-L encoder and the 8-view HoVer-NeXt pass, placed on the L4.
- STACK-031 stays on hold. Every v1 row is non-commercial or unconfirmed, so the line-up is valid only while no paying tenant exists. Before one is planned, STACK-031 is reopened from the ADR 0042 matrix, the `TODO` cells are filled, and the commercial replacements are Option 2 above plus a typer trained on permitted data (TNBC and NuInsSeg are CC BY 4.0).

## Consequences

- The catalogue and the tier defaults of ADR 0159 still name `pathosam-hovernext` and `hovernet`, and the Good tiers point at HoVer-Net. A follow-up task brings the catalogue and defaults in line with the table above. This ADR changes no code.
- AIP-002 (model registry) stores each row with its licence fields as recorded here. Its done-when line still asks for the STACK-031 rule to block a non-commercial model in a commercial tenant, which conflicted with STACK-031 being on hold. The owner chose on 2026-11-04 to record licences only and block nothing while STACK-031 is on hold, and AIP-002 now says so. The block comes back with STACK-031.
- AINUC-000, AISEG-000 and AITUM-000 start from this table and read NucShare, SAFViT, PLUTO-4 and LiteFM in full.
- Open source checks: re-read on Hugging Face, Zenodo and arXiv every cell marked "not re-read" once those hosts are reachable, the PathoSAM and InstanSeg weights licences, and the SAM 3 licence text.

## References

- POC docs 20, 26 and 29, listed in [poc-reference.md](../project/poc-reference.md)
- [ADR 0042](0042-model-licensing-policy.md), licence matrix of 2026-10-14
- Sources linked inline above, read or searched on 2026-11-03
