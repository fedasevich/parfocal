# 0237. A whole-slide run writes one working chunk per tile and resumes from its job units

- Date: 2026-11-06
- Status: Accepted
- Deciders: Yurii Fedas (to confirm), proposed by the agent building AIP-009 (resumable whole-slide jobs)
- Backlog: AIP-009 (resumable whole-slide jobs), shapes AINUC-001 (detector runner) and JOBS-001 (model run API)

## Context

A model run on a whole slide can take long enough that a worker dies, a lease expires or a person pauses it. [ADR 0123](0123-model-runs-are-engine-jobs-per-slide.md) (a model run is one job per slide in the shared job engine) already records finished units in `job_units` and keeps them across resume and retry. The result set chunks of the chunk store sit on a fixed 2048 pixel grid and number cells across the whole set, which a run can only know once every tile is done. The POC wrote one file per tile with a running counter, so a resumed run would have numbered its files differently.

## Options considered

1. Write result set chunks on the 2048 grid as tiles finish. Tiles of a model's core size do not line up with the grid, so a chunk would be rewritten by several tiles and resume would need to merge.
2. Keep resume state in a table of its own. It repeats `job_units` and needs a migration.
3. Write one working chunk per tile under the run's own prefix, keyed by the tile's raster position, and mark that position as a job unit after the chunk is stored. Resume skips the marked units. Placing objects into the result set grid and giving IDs stay later stages.

## Decision

Option 3. A tile is numbered by its place in the full raster grid of the bounds, before tissue is masked out, so the number does not depend on the tissue mask, the tile order or how many tiles ran before. The chunk lives at `t/{tenant}/s/{slide}/runs/{job}/tiles/tile-{index}.pfc` in the existing cell chunk format with the kind `cells`, the tile's core rectangle as its tile, and cells numbered by position inside the tile. A cell belongs to the tile whose core holds its outline centre, so cells seen twice in neighbouring halos are kept once. Tumour-first order only changes which tile runs next. The POC constants stay: a 1536 pixel core and a 60 pixel halo at the model's resolution, and a 64 pixel tissue cell.

## Consequences

- A chunk written just before a crash but not yet marked is written again with the same bytes, because the encoding is deterministic.
- The `objects-placed` and `ids-given` stages of a model run read every tile chunk back and build the result set with `build_cells`, which AINUC-001 (detector runner) or JOBS-001 (model run API) wires up.
- The tile chunks of a finished run are working data and can be removed once the result set exists. TODO: removing them belongs to the retention work.
