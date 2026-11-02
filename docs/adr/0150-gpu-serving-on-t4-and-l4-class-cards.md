# 0150. GPU inference runs in plain PyTorch Modal functions on T4 or L4 class cards, and A100 and H100 class GPUs are out of scope

- Date: 2026-11-02
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: STACK-027 (GPU inference serving). Confirms the AI serving row of [ADR 0003](0003-pilot-platform-architecture.md) (pilot platform architecture) and matches the L4 that [ADR 0147](0147-cloud-provider-regions-and-pilot-cost.md) (cloud provider, regions and pilot cost) prices GPU work on. Touches AISEG-008 (server embedding service), AIP-007 (priority gate) and every task that adds a model

## Context

STACK-027 asked how models are served on GPUs. The candidates were plain PyTorch workers, NVIDIA Triton, Ray Serve and BentoML, and ADR 0003 already chose PyTorch in Modal GPU functions per model family, with batch work starting cold and a separate interactive embedding function that the API pre-warms.

The owner added a hardware rule on 2026-11-02: inference must run on an ordinary NVIDIA server GPU such as the T4 (16 GB), L4 (24 GB) or A10G (24 GB), never on large datacenter GPUs such as the A100 or H100. The POC points the same way. It ran every model on an Apple M4 laptop with 24 GB of unified memory through PyTorch MPS. POC doc 19 (whole-slide nuclei) keeps HoVer-Net batches at 8 under the 4.8 GB memory cap that doc 17 (MONAI models) set, and measured about 100 s per mm² of tissue, an overnight job for a whole CAMELYON slide. Doc 12 (MONAI Label) measured NuClick at 69 to 87 ms and SAM2 at 1,117 ms on MPS. The POC research pages size interactive SAM work at about 87 ms per ViT-H pass on a 16 GB consumer card and show MONAI Label on an A10G with 24 GB. These are sources, not numbers measured here.

The [GPU serving spike](../results/2026-11-02-gpu-serving-spike.md) measured on a Modal T4: a SAM ViT-B embedding takes 0.14 s of GPU time, a pre-warmed container answers in a median 0.26 s with no payload while a whole-slide job runs in its own container, a cold start takes 12 to 16 s with one sample at 40 s, and replies over 2 MB cost about 1.1 s more.

## Options considered

| Option | Why not chosen |
| --- | --- |
| Plain PyTorch in Modal functions, one per model family, on T4 or L4 (chosen) | |
| NVIDIA Triton | Adds model repositories, a server process and its config for a handful of models. Worth it only when many models share one always-on GPU, which scale to zero avoids |
| Ray Serve | Needs a long-lived Ray cluster, which Modal's per-call containers already replace |
| BentoML | A packaging and serving layer on top of what Modal already does, and a second deploy path |
| A100 or H100 class GPUs | Ruled out by the owner. On Modal the A100 costs $2.10 to $2.50 an hour against $0.80 for the L4 and $0.59 for the T4 (`modal billing rates`, 2026-11-02), and no model in the catalogue needs more than 24 GB for inference by the POC's evidence |

## Decision

1. Every model is served by plain PyTorch in a Modal function per model family, as ADR 0003 says. The API never imports Modal, so the same function code can move to another host with a T4 or L4 class card.
2. The default GPU is the T4 (16 GB) for interactive embeddings and light jobs, and the L4 (24 GB) for whole-slide jobs and models that need more memory or speed. The A10G (24 GB, $1.10 an hour on Modal) is an accepted equal of the L4. A100, H100 and larger GPUs are out of scope.
3. Every model must run its inference within 16 GB, or 24 GB when it is assigned to the L4, at the batch size it ships with. A model that does not fit is cut down (smaller batch, float16, a smaller encoder) or not added.
4. Interactive embeddings run in their own function with a 300 s idle scale-down, pre-warmed by the API when a slow device opens the segmentation tool. Whole-slide jobs run in separate containers, which replaces the priority gate.
5. An interactive reply stays under 2 MB, by int8 quantisation or by writing the embedding to R2 and returning its key.

## Consequences

- GPU cost stays at the T4 and L4 prices ADR 0147 uses, about $0.59 and $0.80 an hour on Modal.
- Whole-slide jobs are slower than on an A100. The POC estimated "well under an hour on a datacenter GPU" for a whole slide without measuring it, so the L4 time per slide is TODO, to be measured when the first whole-slide model task runs on Modal.
- Each new model task must record its peak GPU memory on a T4 or L4 in its result file. TODO: the catalogue in `apps/api/src/parfocal_api/model_catalogue.py` gets a GPU field when the first real model is added.
- Triton is reconsidered when the number of models grows enough that per-family functions cost more in cold starts than one shared server.

## References

- [GPU serving spike](../results/2026-11-02-gpu-serving-spike.md)
- POC doc 12 (MONAI Label), doc 17 (MONAI models) and doc 19 (whole-slide nuclei), listed in [poc-reference.md](../project/poc-reference.md)
- Modal GPU types and prices: https://modal.com/pricing
