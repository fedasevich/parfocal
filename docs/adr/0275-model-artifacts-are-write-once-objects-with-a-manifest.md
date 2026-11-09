# 0275. Model artifacts are write-once objects under a per-version manifest in object storage

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas (to confirm), proposed by the agent doing AIP-001 (model artifact storage)
- Backlog: AIP-001 (model artifact storage). Feeds AIP-002 (model registry), AIP-008 (job model and API) and the GPU workers of [ADR 0150](0150-gpu-serving-on-t4-and-l4-class-cards.md) (GPU serving on T4 and L4 class cards)

## Context

AIP-001 asks for versioned, immutable model artifacts (PyTorch checkpoints, ONNX graphs, quantised variants and calibration files) with checksums, and is done when tests refuse an artifact whose checksum does not match. Threat J5 in the [threat model](../security/threat-model.md) (model weights swapped) names this task with AIP-002.

What exists today. `workers/ml` pins the two PathoSAM checkpoints by SHA-256 and size in `sam_contract.py` and reads them and their ONNX exports from a local folder (`PARFOCAL_MODELS_DIR`). Model runs (migration 0046) record `detector`, `detector_version`, `typer` and `typer_version` as plain strings. Storage is S3-compatible through `parfocal_common.object_store`, MinIO locally and R2 in the cloud. The v1 line-up is [ADR 0202](0202-v1-model-line-up-per-tier.md) (v1 model line-up per tier). [ADR 0042](0042-model-licensing-policy.md) (model licensing policy) wanted this store to refuse artifacts with no registry row, but it is rejected.

## Options considered

1. A Postgres table of artifacts now, with the bytes in object storage. The registry task owns the model tables, and another task held the migration slot, so the table would be designed twice.
2. A manifest object per version in object storage, next to the files, with every write conditional so nothing is overwritten. The registry can later point at `(family, version)` and copy the checksums into its table.
3. A client-side check (HEAD then PUT) without conditional writes. Two publishers racing could both pass the HEAD and the second would overwrite the first.

## Decision

Option 2.

- Keys are `models/{family}/{version}/{file}` and `models/{family}/{version}/manifest.json`. Family and version are lowercase letters, digits, dots and dashes, and should match the `detector` and `detector_version` strings a model run stores, so AIP-002 can join on them.
- The manifest is JSON with a schema number and, per file, its name, kind (`pytorch`, `onnx`, `quantised`, `calibration`), size and SHA-256.
- Publishing hashes every local file and refuses the whole version before any write when one size or checksum differs from what was declared. It then writes each file and finally the manifest, each with `If-None-Match: *`, which R2, MinIO and S3 honour with a 412. A version whose manifest exists is sealed and refused. A file left by an interrupted publish is accepted only when its bytes hash to the declared checksum, so a retry with the same files resumes and different bytes are refused.
- Fetching reads the manifest, downloads to a `.part` file, refuses and deletes it when the size or checksum differs, and only then renames it into place. A local file that already matches is not downloaded again.
- A fix to a model is a new version. Nothing deletes or replaces a published version in code.
- The store does not check licences or registry rows. ADR 0042 is rejected and ADR 0202 records licence status without enforcing it. AIP-002 decides whether its registry gates publishing.

The code is `parfocal_common.model_artifacts`, with `ObjectStore.put_new_object` added for the conditional write.

## Consequences

- No table and no migration until AIP-002 (model registry), which adds the table and points at these manifests.
- Files are read whole into memory to hash and upload, which is fine for the 375 MB PathoSAM checkpoint and under the 5 GB single PUT limit. A multipart path is needed only for larger files (`TODO`).
- The ML worker still reads its local folder. Wiring `sam_contract.py` and the Modal image to fetch through this store is follow-up work in the runner tasks.
- Publishing the real v1 artifacts to a dev or production bucket is not done here and is a cloud write logged when it happens.
