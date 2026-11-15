# 0323. The server pools reviewed nuclei like the browser

- Date: 2026-11-15
- Status: Accepted
- Deciders: Claude, waiting for the owner
- Backlog: AILEARN-011 (pool reviewed nuclei on the server from review decisions), AILEARN-010 (collect pooled features of reviewed nuclei), AILEARN-008 (the review viewer gives the learner real embeddings)

## Context

ADR 0320 (pooled features of reviewed nuclei are files per slide) left the pooler to the caller, and only the browser pools SAM features. A training round needs the same features on the server, built from a tenant's review decisions, and a nucleus whose outline a reviewer reshaped kept its first feature. Each stored row also needs the typer's log-probabilities, and the server has no typer run of its own here.

## Options considered

1. Port the browser pooling to Python exactly, and re-pool a row when the outline it was pooled from changes.
2. Pool on the server another way, for example from a mask of the outline at full resolution. That is more precise, but the browser learner and the server rounds would then learn from different features.
3. For the typer part, run the typer again on every reviewed nucleus at every served view count. That is right for a reshape, but it costs a GPU run per collection.
4. For the typer part, take the probabilities the served run stored in the cell chunk, at that run's view count only.

## Decision

Options 1 and 4. `parfocal_ml.server_pooling` reads a 128 micron patch at the level nearest 0.25 microns per pixel around the first waiting nucleus, takes every outline fully inside it, encodes the patch once and pools each outline with the browser's rule: coverage weights from 8 by 8 samples per embedding cell, a two-cell context ring, the centre cell when the outline covers no sample, and `[inside, context]` as the feature. A parity test checks it against numbers from `poolNucleusFeature`. The browser's limit of 24 patches is a page budget and is left out.

Each stored row keeps a short digest of the outline it was pooled from. `collect` pools a nucleus again when the digest differs and replaces its row in place. Per nucleus the outline comes from a reshape first, then from the lowest reviewer id, so two reviewers' reshapes do not swap on every run. Files from before this change have no digests and are pooled once more when outlines arrive.

`parfocal_api.reviewed_nuclei` turns a tenant's cell decisions into rows that `nuclei_of` reads: the reshaped GeoJSON ring without its closing point, else the ring of the cell in the task's result set, the stored probabilities divided by 255, and the view count of the run that made the set, or 1. Outlines no patch can hold, and nuclei without an outline, are left out.

## Consequences

- The browser learner and the server rounds learn from the same feature for the same outline.
- A reshaped nucleus gets a new pooled feature but keeps the typer output of the original cell, because the typer does not run again.
- Rows carry only the served run's view count, so a round can ask only for that count until a typer job fills the others. Nuclei of one slide from runs with different view counts are refused.
- Tests use a seeded fake encoder on CPU. The ONNX encoder loads only when a real job creates it, and the job that runs this on Modal is follow-up work.
