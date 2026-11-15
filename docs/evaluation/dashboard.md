# Evaluation dashboard

Built by `python -m parfocal_ml.dashboard` from 9 ML evaluation result files in [docs/results](../results/README.md). Every value is read from a committed result file or a stored evaluation output. The charts are in [dashboard.html](dashboard.html).

## Automatic segmentation PQ on all 50 TNBC images

Automatic segmentation PQ on all 50 TNBC images: 5 values in 5 variants from 2026-10-18 to 2026-11-08, between 0.8235 and 0.8284, higher is better.

PathoSAM automatic instance segmentation scored by the geometric scorer. The first date rescored the POC's stored predictions, the second ran the parfocal graphs.

Reference: POC browser baseline 0.8235 from [2026-10-18-geometric-scorer-reproduction.md](../results/2026-10-18-geometric-scorer-reproduction.md).

| Date | Variant | Value | Change | Source |
|---|---|---|---|---|
| 2026-10-18 | POC batch | 0.8282 | first | [2026-10-18-geometric-scorer-reproduction.md](../results/2026-10-18-geometric-scorer-reproduction.md) |
| 2026-10-18 | POC browser | 0.8235 | first | [2026-10-18-geometric-scorer-reproduction.md](../results/2026-10-18-geometric-scorer-reproduction.md) |
| 2026-11-08 | uint8 encoder, fp32 AIS decoder | 0.8282 | first | [2026-11-08-auto-region-pass-on-tnbc.md](../results/2026-11-08-auto-region-pass-on-tnbc.md) |
| 2026-11-08 | uint8 encoder, int8 AIS decoder | 0.8284 | first | [2026-11-08-auto-region-pass-on-tnbc.md](../results/2026-11-08-auto-region-pass-on-tnbc.md) |
| 2026-11-08 | 4-bit encoder, int8 AIS decoder | 0.8243 | first | [2026-11-08-auto-region-pass-on-tnbc.md](../results/2026-11-08-auto-region-pass-on-tnbc.md) |

## Nucleus typer ECE after temperature scaling

Nucleus typer ECE after temperature scaling: 6 values in 4 variants from 2026-10-18 to 2026-11-15, between 0.0152 and 0.0223, lower is better.

Expected calibration error of the HoVer-NeXt typer on PanNuke after temperature scaling. The last date is a stand-in training round refitted on held-out slides.

| Date | Variant | Value | Change | Source |
|---|---|---|---|---|
| 2026-10-18 | v1.2, 1 view | 0.0223 | first | [2026-10-18-typing-calibration-reproduction.md](../results/2026-10-18-typing-calibration-reproduction.md) |
| 2026-10-18 | v1.2, 8 views | 0.0187 | first | [2026-10-18-typing-calibration-reproduction.md](../results/2026-10-18-typing-calibration-reproduction.md) |
| 2026-11-04 | v1.2, 1 view | 0.0223 | 0 | [2026-11-04-typer-calibration-registry.md](../results/2026-11-04-typer-calibration-registry.md) |
| 2026-11-04 | v1.2, 8 views | 0.0187 | 0 | [2026-11-04-typer-calibration-registry.md](../results/2026-11-04-typer-calibration-registry.md) |
| 2026-11-15 | round from the typer, refitted | 0.0152 | first | [2026-11-15-recalibration-after-a-round.md](../results/2026-11-15-recalibration-after-a-round.md) |
| 2026-11-15 | round from zero, refitted | 0.0187 | first | [2026-11-15-recalibration-after-a-round.md](../results/2026-11-15-recalibration-after-a-round.md) |

## Nucleus typer accuracy on the PanNuke test split

Nucleus typer accuracy on the PanNuke test split: 6 values in 4 variants from 2026-10-18 to 2026-11-15, between 0.692 and 0.8348, higher is better.

Share of nuclei typed right. The last date is a stand-in training round on its measuring slides.

| Date | Variant | Value | Change | Source |
|---|---|---|---|---|
| 2026-10-18 | v1.2, 1 view | 0.8297 | first | [2026-10-18-typing-calibration-reproduction.md](../results/2026-10-18-typing-calibration-reproduction.md) |
| 2026-10-18 | v1.2, 8 views | 0.8348 | first | [2026-10-18-typing-calibration-reproduction.md](../results/2026-10-18-typing-calibration-reproduction.md) |
| 2026-11-04 | v1.2, 1 view | 0.8297 | 0 | [2026-11-04-typer-calibration-registry.md](../results/2026-11-04-typer-calibration-registry.md) |
| 2026-11-04 | v1.2, 8 views | 0.8348 | 0 | [2026-11-04-typer-calibration-registry.md](../results/2026-11-04-typer-calibration-registry.md) |
| 2026-11-15 | round from the typer | 0.764 | first | [2026-11-15-recalibration-after-a-round.md](../results/2026-11-15-recalibration-after-a-round.md) |
| 2026-11-15 | round from zero | 0.692 | first | [2026-11-15-recalibration-after-a-round.md](../results/2026-11-15-recalibration-after-a-round.md) |

## Evaluation runs

| Date | Result | Backlog |
|---|---|---|
| 2026-10-18 | [the geometric scorer reproduces the POC's TNBC numbers](../results/2026-10-18-geometric-scorer-reproduction.md) | MLEVAL-002 (geometric scorer) |
| 2026-10-18 | [tissue mask on CAMELYON16](../results/2026-10-18-tissue-mask-camelyon.md) | INGEST-012 (tissue mask) |
| 2026-10-18 | [the typing and calibration harness reproduces POC doc 29 for HoVer-NeXt](../results/2026-10-18-typing-calibration-reproduction.md) | MLEVAL-004 (typing and calibration evaluation) |
| 2026-11-02 | [tissue box that ignores specks](../results/2026-11-02-tissue-box.md) | INGEST-027 (tissue box that ignores specks) |
| 2026-11-04 | [HoVer-NeXt reaches an ECE of 0.022 with one view and 0.019 with 8 views after temperature scaling, and the registry stores those rows](../results/2026-11-04-typer-calibration-registry.md) | AINUC-006 (calibration) |
| 2026-11-06 | [Interactive protocol reproduces POC doc 26 on TNBC](../results/2026-11-06-interactive-protocol-on-tnbc.md) | MLEVAL-003 (interactive protocol) |
| 2026-11-06 | [Smart select accuracy smoke on 78 TNBC nuclei in Chrome](../results/2026-11-06-smart-select-accuracy-smoke.md) | AISEG-005 (smart select tool) |
| 2026-11-08 | [the auto region pass scores PQ 0.828 on all 50 TNBC images and a warm four tile pass takes 12.2 s on WebGPU](../results/2026-11-08-auto-region-pass-on-tnbc.md) | AISEG-010 (auto region tool) |
| 2026-11-15 | [two stand-in typer rounds on PanNuke keep an ECE of 0.077 and 0.089 with the old temperature and reach 0.015 and 0.019 after refitting on held-out slides](../results/2026-11-15-recalibration-after-a-round.md) | AILEARN-005 (recalibration after each round) |
