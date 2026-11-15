# 0321. The model registry is a platform table that operators write and every workspace reads

- Date: 2026-11-15
- Status: Accepted
- Deciders: the agent doing AIP-020 (runtime model registration and model parts in the registry), under the build-the-obvious rule
- Backlog: AIP-020 (runtime model registration and model parts in the registry). Builds on AIP-002 (model registry), [ADR 0202](0202-v1-model-line-up-per-tier.md) (the v1 model line-up per tier) and JOBS-005 (lab models connected through their own endpoint)

## Context

AIP-002 kept the registry as a tuple in `model_registry.py`, so a new model or version needed a deploy. AIP-020 asks for registration while the app runs, licence fields on lab models, and a row with a version for every separate part in the ADR 0202 line-up, such as the PathoSAM encoders and decoders.

## Options

1. A tenant table, written by workspace admins. Each workspace would hold its own copy of models Parfocal hosts, and one workspace could not see another's registration.
2. A platform table with no tenant column, written only by platform operators and read by every member, with lab models keeping their licence on their own tenant row.
3. Keep the code registry and add a JSON file read at start. Still needs a deploy to change.

## Decision

Option 2. The `registered_models` table has row security with a `platform_write` policy for operators and a `platform_read` policy open to everyone, like `tenants` and `organisations`. `POST /api/platform/model-registry` registers a model and audits `model.registered`. The two existing reads keep their paths and now read the table.

The migration only adds. It creates the table, seeds it from the code registry (the three AIP-002 models and seven parts), and adds nullable licence columns to `lab_models`. A part names its whole model through `part_of_name` and `part_of_version`, a foreign key into the same table. An encoder part may make nothing visible, every other model must make regions, cells or a heatmap.

The parts are the PathoSAM ViT-L and ViT-B encoders, AIS decoders and click and box decoders, and the HoVer-NeXt PanNuke typer. No part has a pinned release of its own, so each carries `v1.2`, the version of `pathosam-hovernext` that ships it. The MONAI tumor model is one part and keeps its own row.

## Consequences

- A model registers without a deploy. Editing a seeded row or retiring one is still a later task, since nothing updates or deletes rows yet.
- The code tuple stays as the seed source and as the input to the unit tests. The migration imports it, as migration 0044 (study templates) does, so a later edit to the tuple does not change rows already seeded.
- Lab models may carry a licence when connected. The field is optional, so the connect screen needs no change until it offers one.
- `TODO` real part versions once AIP or MLEVAL work pins each checkpoint.
