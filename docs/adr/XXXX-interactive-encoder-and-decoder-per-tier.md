# XXXX. PathoSAM ViT-B stays the interactive encoder in every tier, with the window decoder for clicks and the int8 AIS decoder for regions, because no smaller or newer SAM has a better held-out number here

- Date: 2026-11-16
- Status: Proposed
- Deciders: Yurii Fedas, proposed by the agent doing AISEG-000 (interactive segmentation research check)
- Backlog: AISEG-000. Revises the interactive rows of [ADR 0202](0202-v1-model-line-up-per-tier.md) (v1 model line-up per tier). Builds on [ADR 0246](0246-pathosam-onnx-export-contract.md) (PathoSAM ONNX export contract), [ADR 0250](0250-sam-graph-per-execution-provider.md) (SAM graph per execution provider), [ADR 0349](0349-nucleus-detector-and-typer-per-tier.md) (nucleus detector and typer per tier) and [ADR 0359](0359-find-more-like-these.md) (find more like these is a no-go on PathoSAM tokens). Touches AISEG-013 (fast tier in the browser without a GPU)

## Context

AISEG-000 asks which encoder and decoder each tier runs for click, box and region work, comparing PathoSAM and its AIS decoder, newer SAM variants, small SAMs (EfficientViT-SAM, EdgeSAM, MobileSAM) and exemplar prompting with SAM 3 on the held-out sets. ADR 0202 put PathoSAM ViT-L on Best, ViT-B on Good and nothing on Fast, before anything was measured in this repository.

The rules of the check: start from what is measured, measure a missing small SAM on the Mac only if its weights are a public download under 500 MB, run nothing on a cloud GPU, and mark gated models unmeasured.

## Evidence

### Measured in this repository, TNBC only

TNBC (50 images, 3,466 prompted nuclei) is the only held-out set run here. CryoNuSeg and NuInsSeg have loaders but were never run, so every "here" number below is TNBC alone.

| Model and graphs | Click IoU | Exact box IoU | Loose box IoU | Three clicks | Source |
|---|---|---|---|---|---|
| PathoSAM ViT-B, uint8 encoder, full decoder | 0.852 | 0.863 | 0.817 | 0.881 | [interactive protocol](../results/2026-11-06-interactive-protocol-on-tnbc.md) |
| PathoSAM ViT-B, fp32 encoder, full decoder | 0.854 | 0.864 | 0.818 | 0.882 | [small SAM result](../results/2026-11-16-mobilesam-on-tnbc.md) |
| MobileSAM (ViT-Tiny, generic, not fine-tuned on pathology), fp32 | 0.573 | 0.791 | 0.765 | 0.726 | [small SAM result](../results/2026-11-16-mobilesam-on-tnbc.md) |

Graph agreement and speed for PathoSAM ViT-B.

- Encoder against PyTorch on 78 TNBC clicks: fp32 mean IoU 0.9999, uint8 0.9668, 4-bit 0.9614 ([export result](../results/2026-11-06-pathosam-onnx-export.md)).
- Encode in Chrome on the M4: 1.1 to 1.5 s on WebGPU with the 4-bit graph, 5.3 to 5.9 s on WebAssembly with the uint8 graph ([provider result](../results/2026-11-06-sam-variants-per-provider.md)).
- Click decode: the 32 token window decoder matches the full decoder at a mean IoU of 0.990 (minimum 0.945) and decodes in 17 ms on WebGPU and 14 ms on WebAssembly, against 32 and 54 ms for the full decoder ([window result](../results/2026-11-15-embedding-window-decoder.md)).
- Region decode: the int8 weight-only AIS decoder gives TNBC PQ 0.8284 with the uint8 encoder against 0.8282 for fp32 AIS, and 0.8243 with the 4-bit encoder of WebGPU, at a quarter of the download ([auto region result](../results/2026-11-08-auto-region-pass-on-tnbc.md)). Without the AIS decoder, the prompt pass reaches PQ 0.7959 ([prompt fallback result](../results/2026-11-16-prompt-fallback-on-tnbc.md)).
- Exemplar search on PathoSAM tokens fails both of its criteria, PQ 0.754 against 0.841 for a prompt at every true centroid ([exemplar result](../results/2026-11-16-exemplar-search-on-tnbc.md), ADR 0359).

### From the POC, three held-out sets

[POC doc 26](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/26-held-out-benchmarks.md) (held-out benchmarks) ran TNBC, CryoNuSeg and NuInsSeg with the same prompt rules. Held-out means:

| Model | Realistic click | Exact box | Loose box | Three clicks | Clicks at IoU 0.75 or better |
|---|---|---|---|---|---|
| PathoSAM ViT-B, contour outlines | 0.674 | 0.805 | 0.740 | 0.775 | 53.3% |
| SAM 2 Hiera-L | 0.447 | 0.797 | 0.756 | 0.654 | 35.9% |
| SlimSAM-77 (generic small SAM) | 0.537 | not in doc 26 | not in doc 26 | 0.579 | 39.1% |

SAM 2 matches PathoSAM on boxes and loses 0.23 on a click. The generic small SAM loses 0.14 on a click.

### Published, not comparable

- SAM 3. The weights on [Hugging Face](https://huggingface.co/facebook/sam3) are gated behind a sign-in and the acceptance of terms, so SAM 3 is unmeasured here. [Is SAM3 ready for pathology segmentation?](https://arxiv.org/html/2604.18225v3) (Kong et al., v3 of 2026-05-19) scores image-level mIoU, not IoU per prompted nucleus. Its text prompts reach 6.22 mIoU on PanNuke with the best wording. Its few-shot box prompts give SAM 3 45.06 on NuInsSeg against 45.26 for SAM 1. On zero-shot points it is below SAM 1 on NuInsSeg in three of four settings and equal in the fourth, and it leads on boxes, most with a box on every nucleus (81.19 against 77.08 on NuInsSeg). The paper compares no pathology fine-tune such as PathoSAM.
- EdgeSAM. Its [repository](https://github.com/chongzhou96/EdgeSAM) reports COCO mask AP 42.2 against 39.4 for MobileSAM and 46.1 for SAM, and 38.7 against 4.9 frames per second on an iPhone 14. NTU S-Lab License 1.0. No pathology numbers.
- EfficientViT-SAM. Its [README](https://github.com/mit-han-lab/efficientvit/blob/master/applications/efficientvit_sam/README.md) reports COCO mAP 45.7 (L0) to 47.8 (XL1) with detector boxes as prompts, and states no licence on that page. No pathology numbers.
- No small SAM fine-tuned on pathology was found. The micro-sam model registry ([`util.py`](https://github.com/computational-cell-analytics/micro-sam/blob/master/micro_sam/util.py)) has histopathology checkpoints for ViT-B, ViT-L and ViT-H only. Its ViT-Tiny checkpoints are generic MobileSAM, light microscopy and electron microscopy. One web search on 2026-11-16 found pathology adaptations of the larger ViT-B only, such as a LoRA on a frozen SAM ViT-B ([arXiv 2603.20326](https://arxiv.org/pdf/2603.20326), seen as a search snippet only, no numbers taken), and nothing for MobileSAM, EdgeSAM or EfficientViT-SAM.
- PathoSAM ViT-L, the size its authors recommend, is a 1,249,494,242 byte download per the registry server, over the local cap of 500 MB, so it is unmeasured here.

## Options considered

1. Keep ADR 0202 as written: PathoSAM ViT-L on Best, ViT-B on Good, nothing on Fast. Best then ships a model with no held-out number in this repository.
2. PathoSAM ViT-B in every tier that has a model, differing only in where the encoder runs and which graph it loads, with ViT-L returning to Best once it is measured. Fast stays empty until a small SAM is fine-tuned on pathology.
3. Put a small SAM on Fast now. MobileSAM is the only one measured here, and it is generic: 0.279 below PathoSAM on a click and 0.072 on an exact box on TNBC, with 46% of realistic clicks at IoU 0.75 or better against 89%.
4. Add SAM 2 Hiera-L on the server as the box model of Best. It gains 0.016 on loose boxes held-out and loses 0.008 on exact boxes and 0.23 on clicks, and costs a second embedding per tile.

## Decision

Option 2, the same shape as ADR 0349 gave the detector.

| Work | Tier | Encoder | Decoder | Runs on | Evidence |
|---|---|---|---|---|---|
| Click and box | Best | PathoSAM ViT-B fp32 | 32 token window decoder, the full decoder at the window edge | Encoder on the server T4, decoder in the browser | fp32 matches PyTorch at mean IoU 0.9999. TNBC click 0.854 and exact box 0.864, 0.001 to 0.002 over uint8 |
| Click and box | Good | PathoSAM ViT-B, 4-bit on WebGPU and uint8 on WebAssembly, as ADR 0250 loads them | As Best | Browser | TNBC click 0.852 and box 0.863 with uint8. 4-bit agrees with PyTorch at 0.961 |
| Click and box | Fast | None | | | Generic MobileSAM scores 0.573 on a TNBC click, 0.279 below PathoSAM, though its CPU encode is 370 ms against 2,165 ms |
| Region (auto tool) | Best and Good | The tier's encoder above | int8 weight-only AIS decoder, prompt pass as fallback | As above | TNBC PQ 0.8284 with uint8 and 0.8243 with 4-bit. Fallback 0.7959 |
| Region (auto tool) | Fast | None. AISEG-013 still decides the CPU-only path | | | |
| Exemplar (find more like these) | All | None | | | ADR 0359 no-go. SAM 3 gated and unmeasured |

Rules that follow.

1. PathoSAM ViT-L returns to Best when a ViT-L export beats the fp32 ViT-B's TNBC realistic click of 0.854 and exact box of 0.864 on the same harness, and its embedding still fits the float16 tile of [ADR 0346](0346-server-embeddings-are-float16-tiles-in-the-slide-bucket.md) (server embeddings are float16 tiles).
2. A small SAM enters Fast when it is fine-tuned on PathoSAM's public training sets and reaches within 0.03 of ViT-B on a TNBC click and box, while encoding a 1024 px tile on WebAssembly in under 1 s. That is a training run on a GPU, outside this task.
3. SAM 2 Hiera-L is not added. Its only gain is 0.016 on loose boxes, and one encoder per tier keeps one embedding per tile.
4. Every new candidate runs `pnpm --filter @parfocal/ml bench:interactive` on TNBC first, and on CryoNuSeg and NuInsSeg once the harness handles their labels.

## Consequences

- The Best interactive row of ADR 0202 changes from ViT-L to ViT-B fp32 on the server. The model registry in `parfocal_api.model_registry` already keeps the three ViT-L rows at status `candidate`, which matches rule 1, so this ADR changes no code. A follow-up points the Best interactive default at the ViT-B encoder where it still names ViT-L.
- The held-out mean over three sets still comes only from the POC. Running CryoNuSeg and NuInsSeg in this harness is the follow-up the interactive protocol result already names, `TODO`.
- The Best row is the server encoder that decision 117 (which encoder the server embedding service runs) recommends, the fp32 ViT-B on a T4 writing the float16 tiles of ADR 0346. The `embedder` pool is still a stub per ADR 0346, so Best runs only once that decision is taken and the pool gets real weights.
- Measuring the ViT-L encoder and AIS decoder needs a 1.25 GB download, which decision 117 and decision 123 (whether agents may download newer nucleus models) already ask about. Fine-tuning a small SAM needs a GPU run, decision XXX in `docs/decisions.md`.
- Licence status is unchanged from ADR 0202: PathoSAM weights `TODO` and trained on non-commercial data. MobileSAM code is Apache-2.0 and its checkpoint licence `TODO`, per ADR 0042, not re-read here.

## References

- Results linked inline above, and POC doc 26 in [poc-reference.md](../project/poc-reference.md)
- Sources linked inline above, read on 2026-11-16
