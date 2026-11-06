# XXXX. Sample slides share one stored original, named by a folder claim in the tile token

- Date: 2026-11-06
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: ONB-007 (sample slide files). Builds on ADR 0139 (the sample project) and TILES-001 (signed access to slide bytes)

## Context

Every workspace that picks the sample project gets four CAMELYON16 slides of about 1 to 2.5 GB each. The edge reads a slide's files only under `t/{tenant}/s/{slide}/`, built from the token's tenant and slide claims. The `slides` row already has `original_key`, `file_bytes`, `sha256` and the pyramid facts, so no migration is needed for the row.

## Options considered

1. Copy the four originals and their derived files under each new sample slide's own prefix. The edge stays as it is, but every workspace adds about 7 GB to storage and the copy runs inside the request that seeds the sample.
2. Store each original and its derived files once under `samples/camelyon16/{label}/`, point every sample slide row at it, and add an optional claim `p` to the signed tile token that names that folder. The edge reads from `p` when present and accepts only folders under `samples/camelyon16/`.

## Decision

Option 2. A loader, `python -m parfocal_ingest.sample_files FOLDER`, runs the ingest readers on each file, streams the original up in parts while hashing it, and writes `levels.json`, the tile index, previews, `restricted-ranges.json` and a `facts.json` with size, checksum and pyramid facts. Seeding the sample copies `facts.json` into each slide row. When a file is missing the row stays without a file, as ADR 0139 describes. The API reads the restricted ranges next to the original, which for an uploaded slide is the same key as before, and adds `p` only when the original sits outside the slide's own prefix, so every other token stays byte for byte the same.

## Consequences

- Storage holds one copy of each sample file for all workspaces, and retention never touches it, because it deletes by the tenant's slide prefixes.
- Label and macro images of the sample files are not stored, so their bytes stay closed through the restricted ranges and no sample slide offers them.
- The loader has not yet run on the real CAMELYON16 files, which are not on disk. Its tests use a synthetic TIFF in their place.
