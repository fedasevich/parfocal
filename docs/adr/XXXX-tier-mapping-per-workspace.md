# XXXX. Each workspace maps Best, Good and Fast to an exact model per task in its own table

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: AIP-003 (tiers Best, Good, Fast). Fills the tier label that AIP-011 (job progress streaming) left empty

## Context

The frozen mock (§2.14) shows Best, Good and Fast instead of model names, with the exact model on hover, and says the lab decides which model each tier uses while the report records the exact model and version. The card asks for a mapping per task and per site. There is no site entity, and site validations already belong to the workspace, so the site is the workspace. The model registry (AIP-002) does not exist yet, so the API's model catalogue is the list of models a tier may name. ADR 0042 (model licensing policy) is rejected, so no licence check by tenant kind applies to the mapping.

## Options considered

1. Keep the mapping as keys in `workspace_settings.values`, beside the other lab settings. No new table, but the settings catalogue only knows choices, switches and whole numbers, a model choice needs the catalogue to check it, and a run would read the mapping out of a JSON blob with no constraint on task or tier.
2. A `model_tiers` table with one row per workspace, task and tier, holding the exact model name and version, under the usual tenant isolation. Rows exist only where the lab chose something, and defaults from the catalogue fill the rest.
3. Store only the model name and resolve the version at run time. A new model version would then change what a tier runs without anyone choosing it.

## Decision

Option 2. `model_tiers` has a unique key on workspace, task and tier, check constraints on both, and the version is pinned when the lab sets it. A tier with no row uses the default in `parfocal_api.model_tiers` (Best and Good from the catalogue, Fast empty because the mock's Fast models run in the browser). A run started by tier stores the exact model and version as its detector and the tier in `model_runs.tier`, and the worker labels its stage throughput with it.

## Consequences

- A run asked for an empty tier is refused with `tier-not-mapped`, so a lab must map Fast before a server run can use it.
- When AIP-002 (model registry) lands, the check that a tier names a known model moves from the catalogue to the registry, and the table keeps its shape.
- The run API takes one tier for the detector. A tier per role (detector and typer) is left for later.
