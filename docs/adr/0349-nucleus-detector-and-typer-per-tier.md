# 0349. PathoSAM AIS stays the nucleus detector and HoVer-NeXt the typer in every server tier, because no newer model has a held-out number here

- Date: 2026-11-16
- Status: Proposed
- Deciders: Yurii Fedas, proposed by the agent doing AINUC-000 (nuclei detector and typer research check)
- Backlog: AINUC-000. Confirms the nuclei rows of [ADR 0202](0202-v1-model-line-up-per-tier.md) (v1 model line-up per tier) and replays [ADR 0194](0194-confidence-display-rules-and-evidence.md) (confidence display rules and evidence). Touches STACK-031 (model licensing policy, on hold), AINUC-002 (typer runner), AINUC-011 (throughput target) and AISEG-013 (fast tier in the browser without a GPU)

## Context

AINUC-000 asks for a detector and a typer per tier from current models, naming PathoSAM AIS, HoVer-NeXt, CellViT++, NuLite and InstanSeg, under the STACK-031 licence policy, with MLEVAL numbers, and a replay of ADR 0194's table for the chosen typer.

The licence policy is not a filter today. [ADR 0042](0042-model-licensing-policy.md) (model licensing policy) was rejected on 2026-10-15 because the owner said Parfocal will not really be commercial, STACK-031 is on hold, and ADR 0202 records licences without enforcing them. So ADR 0194's remark that ADR 0042 "probably rules out HoVer-NeXt" no longer applies, and each row below records its licence for the day STACK-031 reopens.

Three kinds of number appear here and are kept apart. Measured in this repository by the MLEVAL harness. Measured by the POC on held-out sets and listed in [poc-reference.md](../project/poc-reference.md). Reported by a paper, read on 2026-11-16 from the arXiv abstract only. Only the first two count as evidence for a pick.

No new weights were downloaded for this check. The machine holds the PathoSAM ViT-B weights and their ONNX exports and the POC's HoVer-NeXt PanNuke weights with its cached outputs. Nothing else on the list is on the machine, so CellViT++, NuLite and InstanSeg stay unmeasured.

## Evidence

### Detector, held out

| Model | Number | Kind | Source |
|---|---|---|---|
| PathoSAM ViT-B AIS, PyTorch | TNBC PQ 0.828, F1 0.952, all 50 images | The POC's prediction files, re-scored by this repository's scorer | [scorer reproduction](../results/2026-10-18-geometric-scorer-reproduction.md) |
| PathoSAM ViT-B AIS by pixel size | PQ 0.543 at 0.25 µm/px, 0.541 at 0.33 µm/px on the POC's `dev` set | POC doc 26 | held-out benchmarks |
| PathoSAM ViT-B AIS, browser graphs | TNBC PQ 0.828 (uint8 encoder), 0.824 (4-bit, WebGPU) | This repository | [auto region pass](../results/2026-11-08-auto-region-pass-on-tnbc.md) |
| PathoSAM ViT-B AIS, server runner | Reproduces the PyTorch reference, 97.5% of 366 centres within 2 px. 252 to 333 s per mm² on an M4 CPU, 8.19 GB peak | This repository | [detector throughput](../results/2026-11-06-nuclei-detector-throughput.md) |
| PathoSAM ViT-B AIS | Mean PQ 0.596, F1 0.740 over TNBC, CryoNuSeg and NuInsSeg. MoNuSeg 0.648 is in its training pool | POC doc 26 | held-out benchmarks |
| HoVer-Net | Mean PQ 0.211, F1 0.289 on the same three sets | POC doc 26 | held-out benchmarks |
| PathoSAM ViT-L AIS | None | Unmeasured | No ViT-L score in this repository's results or the POC docs. POC doc 20 says only that ViT-L is the size the PathoSAM authors recommend |
| HoVer-NeXt as a detector | None held out | Unmeasured | Doc 29 lists it as a follow-up only |
| CellViT++, NuLite, InstanSeg | None | Unmeasured | Weights not on the machine |

### Typer

| Model | Number | Kind | Source |
|---|---|---|---|
| HoVer-NeXt, PanNuke weights, one view | 83.0% right (81.7% balanced), T 1.42, ECE 0.032 to 0.022 on fold 3, 12,928 nuclei | This repository, on the POC's cached outputs | [reproduction](../results/2026-10-18-typing-calibration-reproduction.md), [calibration](../results/2026-11-04-typer-calibration-registry.md) |
| HoVer-NeXt, 8 views | 83.5% (82.1%), T 1.29, ECE 0.020 to 0.019 | Same | Same |
| CoNSeP classifier (MONAI) | 48.9% on the same nuclei | POC doc 29 | better typer |
| CellViT++, NuLite | None here. Both report PanNuke results (POC doc 20), and the NuLite README says its weights derive from PanNuke (ADR 0042), so a PanNuke fold 3 score is unlikely to be held out for them | Unmeasured | |
| InstanSeg | No typing head | Not a typer | |

The HoVer-NeXt numbers are in-domain, since it trained on PanNuke fold 2. No typer on the list has a held-out typing number. The dataset registry in `parfocal_ml.datasets` holds two typed sets, PanNuke and Lizard, and no typer has been scored on Lizard here.

### Newer papers, abstracts only

ADR 0202 asked this check to read NucShare, SAFViT and CellNuc-DETR in full. Only the arXiv abstracts were read, on 2026-11-16.

- NucShare ([arXiv 2609.35203](https://arxiv.org/abs/2609.35203)) reports PanNuke mPQ 0.524 and 0.519 and a zero-shot MoNuSeg bPQ of 0.668. Code is linked, the weights and their licence are not stated.
- SAFViT ([arXiv 2607.27835](https://arxiv.org/abs/2607.27835)) reports PanNuke mPQ 0.471 for a gated CellViT. No code or weights are linked.
- CellNuc-DETR ([arXiv 2502.06307](https://arxiv.org/abs/2502.06307)) is evaluated on PanNuke with cross-dataset tests on CoNSeP and MoNuSeg. The abstract gives no PQ or F1, only that it runs twice as fast as HoVer-NeXt. No weights are linked.

No abstract mentions TNBC, CryoNuSeg or NuInsSeg, the sets PathoSAM AIS is judged on, and PanNuke mPQ mixes detection with typing in-domain. The full texts were not read, so a held-out number inside them is not ruled out. None displaces a row below on what was read.

## Options considered

1. Keep ADR 0202's nuclei rows, and move any row without a number to the nearest measured model. The licences are non-commercial or unconfirmed, which is acceptable while STACK-031 is on hold.
2. Replace HoVer-NeXt with CellViT++ or NuLite for typing. Both are PanNuke-trained like HoVer-NeXt, carry the Commons Clause on their code, have no measured number here, and CellViT++ cannot share some checkpoints. Nothing would be gained that can be shown.
3. Measure CellViT++, NuLite and InstanSeg first. Needs weight downloads the owner has not approved for this run, and for CellViT++ and NuLite the only typed test set at hand is PanNuke, which they trained on. Left as a follow-up.

## Decision

Option 1, with one change. ADR 0202 put PathoSAM ViT-L on the Best detector row, and no ViT-L AIS score exists, so Best runs the measured ViT-B at the finer pixel size and Good runs it at the runner's fast pixel size. ViT-L returns to Best once a ViT-L AIS export beats ViT-B's TNBC PQ of 0.828 on the same scorer. The interactive rows of ADR 0202 are untouched.

| Task | Tier | Model | Evidence | Licence today |
|---|---|---|---|---|
| Detector | Best | PathoSAM ViT-B AIS at 0.25 µm/px on L4 | TNBC PQ 0.828 here, held-out mean PQ 0.596 in the POC, 0.543 on `dev` at this pixel size | Code MIT, weights `TODO`, trained on non-commercial data |
| Detector | Good | PathoSAM ViT-B AIS at 0.33 µm/px on T4 | 0.541 on `dev` at this pixel size in the POC, and 0.76 of best's time on the larger region of the throughput result | As above |
| Detector | Fast | PathoSAM ViT-B AIS in the browser on WebGPU | TNBC PQ 0.824 here | As above. Without WebGPU, AISEG-013 still decides |
| Typer | Best | HoVer-NeXt PanNuke weights, 8 views, T 1.29 | 83.5%, ECE 0.019 | Weights CC BY-NC-SA 4.0, code GPL-3.0, so no code is copied here |
| Typer | Good | HoVer-NeXt PanNuke weights, one view, T 1.42 | 83.0%, ECE 0.022 | As above |
| Typer | Fast | None | | |

The confidence display table of ADR 0194 was replayed for both typer rows by the new `parfocal_ml.confidence_display` ([result](../results/2026-11-16-confidence-display-replay-hovernext.md)). One view reproduces doc 33 exactly. With 8 views every typer-dependent rule holds, and the expected mistakes range gives no wrong firm answer on 32 regions, so firm answers may turn on for both rows. The one weaker figure is "about N cells", which settles 7 of 13 open cases with 8 views against 12 of 16 with one view, all of them right. The store of AINUC-006 (calibration) and AINUC-007 (confidence bands) already holds both rows, so nothing changes in code.

## Consequences

- ADR 0194's rows are now evidenced for the chosen typer at both view counts. Its vector scaling, CMU-1 warning and "may not be a nucleus" rows were not rerun, because they rest on the CoNSeP classifier, a POC whole-slide run and PathoSAM outlines.
- The replay ran on the POC's cached outputs on true outlines. When AINUC-002 writes outputs from the Parfocal typer runner on PathoSAM outlines, rerun the calibration command and `python -m parfocal_ml.confidence_display` on them.
- The tier defaults of ADR 0159 (tier mapping per workspace) and the catalogue must name ViT-B for the Best detector. The follow-up task ADR 0202 already asked for, bringing the catalogue and defaults in line, picks this up.
- Whether agents may download the unmeasured models is decision 123 in [decisions.md](../decisions.md).
- Follow-ups worth a task each, none needed for v1: score a PathoSAM ViT-L AIS export on TNBC, CryoNuSeg and NuInsSeg; score InstanSeg on the same sets as a no-WebGPU detector for AISEG-013 once its weights are fetched with the owner's yes; score HoVer-NeXt's own instances as a detector.
- When STACK-031 reopens, every row above is blocked, and the commercial path stays the one ADR 0202 names: a typer trained on permitted data.
