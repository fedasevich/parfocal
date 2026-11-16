# XXXX. The tumor map pool runs onnxruntime-gpu on a CUDA 13 cuDNN base and reuses the API's database and storage secrets

- Date: 2026-11-16
- Status: Accepted
- Deciders: Yurii Fedas, proposed by the agent doing AITUM-011 (the tumor map pool is ready to deploy)
- Backlog: AITUM-011. Builds on ADR 0355 (the tumor map job shares the detector-good T4 pool), ADR 0356 (the tumor map worker runs the ResNet18 as ONNX) and ADR 0276 (write-once model artifacts).

## Context

The pool image was `nvidia/cuda:12.9.1-runtime` with no cuDNN and no ONNX runtime. `onnxruntime-gpu` 1.31.1, the GPU build of the runtime the CPU stand-in already uses, declares `nvidia-cuda-runtime~=13.0` and `nvidia-cudnn-cu13~=9.0`, so it does not load its CUDA provider on a CUDA 12 image. Modal's GPU hosts run driver 610.57.04 with CUDA Driver API 13.3 (Modal's CUDA guide, read 2026-11-16). The detector-good function had no secrets, and the tumor map worker needs `DATABASE_URL` and the `STORAGE_*` settings.

## Options

1. Base image. A: keep CUDA 12.9 and pin an older `onnxruntime-gpu` built for CUDA 12. B: move to `nvidia/cuda:13.3.1-cudnn-runtime-ubuntu24.04`, the newest CUDA 13 tag not past the host driver. C: keep the base and lock the `nvidia-*-cu13` wheels through the runtime's `cuda` and `cudnn` extras.
2. Secrets. A: attach the existing `parfocal-api-keys` and `parfocal-api-config` to the detector-good function only. B: a new narrow secret holding only the database URL and storage keys.

## Decision

1B and 2A.

The pool's `pool` extra pins `onnxruntime-gpu==1.31.1` on Linux with `openslide-bin` and `openslide-python`, and `workers/deploy/locks/ml.txt` exports that extra. The CPU `onnxruntime` stays out of the image, because both wheels install the same module. The scorer refuses to run on a GPU pool when the session has no CUDA provider, so a broken image fails the job instead of scoring on the CPU while a T4 is billed.

Only the detector-good function gets the two secrets. The embedder function, which answers view map calls since AITUM-012 (the interactive pool answers view map calls), reads slides and the model artifact but never the database, so it gets `parfocal-api-config` alone. That secret is the only one holding the `STORAGE_*` settings, so the embedder also receives the Zitadel client secret it does not use. The API wakes it with `{"kind": "tumor-map"}` after it queues a map, through the same `ModalPools` its embedder warm uses. A failed spawn is logged and the job stays queued.

## Why

- 1A would keep the runtime two versions apart between the CPU check and the pool. 1C adds about 1 GB of CUDA wheels to a lock that must carry a hash for each one, where the NVIDIA image is one pinned digest.
- 2A follows rotation for free. `rotate` rewrites `DATABASE_URL` in `parfocal-api-keys`, and Modal injects secrets when a container starts. A copy in a new secret would go stale on the next rotation until someone teaches `rotate` about it.

## Consequences

- The detector-good container also receives the session, master, tile token and Zitadel keys, and runs OpenSlide on uploaded originals outside the parse sandbox. The embedder container receives the Zitadel client secret and the storage keys. A narrow storage secret is the fix if either pool ever runs code a tenant controls.
- Every pool shares the image, so every pool now pulls the larger cuDNN base on a cold start. The cold start of the T4 with this image is not measured yet (TODO).
- The model artifact lives in `parfocal-dev`, the bucket the deployed app reads. OPS-014 (prepare production for the first real user) must copy `models/` when it moves production to `parfocal-prod`.
