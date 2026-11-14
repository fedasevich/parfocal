# XXXX. A streamed run is a scene of sealed blocks per lineage

- Date: 2026-11-14
- Status: Accepted
- Deciders: Claude
- Backlog: AINUC-013, AINUC-010, JOBS-007

## Context

AINUC-013 (stream a whole-slide run onto the open slide) draws a run's nuclei while the run is still going. AIP-011 (job progress streaming) gives a cursor over finished areas, `listModelRunAreas`, and the worker writes one cell chunk per tile under `tiles/tile-NNNNNN.pfc`, numbered inside the tile. The POC's streamed job ([doc 19](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/19-whole-slide-nuclei.md)) found that a full rebuild of 250,000 nuclei costs 241 ms, seven times a 33 ms frame, so it cached triangles per lineage, extended them only for new nuclei, copied runs as blocks and rebuilt at most every 3 s and never more than 5% of the time.

## Options considered

Where streamed objects live:

1. A separate `StreamedScene`, keyed by run lineage and tile, that holds triangulated batches. It needs no summary, which a running run does not have yet.
2. Extending `PagedCells` from [ADR 0242](0242-client-chunk-paging-for-large-nuclei-sets.md) (client chunk paging). It is built around a finished summary, global cell numbers and eviction, none of which exist mid-run.

How a rebuild reaches the GPU:

1. One merged batch for the whole scene. Every rebuild copies and uploads everything, which is the POC's 241 ms.
2. Sealed blocks of 16,384 polygons per lineage, each its own layer. A rebuild merges only the blocks that changed, and deck.gl skips layers whose data is the same object.

## Decision

Option 1, then option 2.

- `StreamedScene` keeps, per lineage, the tiles in the order they first arrived and assigns each to the open block. A tile is triangulated once when it arrives, in slices of 1,000 polygons with a task break between them. A tile reported again with a higher sequence number, as a later stage would, replaces its polygons and marks only its block dirty.
- A rebuild pass merges one dirty block at a time and hands the blocks over after each, with a frame between, so a frame uploads at most one new block. Unchanged blocks are handed over by reference. `merged()` of the scene equals `polygonBatchFromRings` over the same polygons, which the tests check.
- `RebuildGate` lets a pass through when 3 s have passed and the last pass's cost is under 5% of the gap. The first pass runs as soon as the first tile lands, and the last one runs when the run ends.
- A tile records its sequence number only with its last slice, so a stream closed in the middle of a tile appends the whole tile again when it is opened again.
- `RunStream` polls the areas cursor, fetches each finished tile's chunk, appends it under the run's lineage, keeps the finished tiles for marks, and reports progress with an estimate from the areas' finish times once two have finished. Cancel asks the source to cancel and keeps polling through `cancelling` until the run ends, so every finished tile stays.
- A stream opened again on the same lineage skips tiles it already holds, so a resumed run continues and is not doubled.

## Consequences

- `getModelRunTile` serves a finished tile's chunk while the run goes on, and the areas answer carries the model stage's total. In the app, `use-run-stream.ts` starts a slide run, streams it and registers one engine overlay per block plus one for the finished-tile marks. `run-stream-layer.tsx` shows progress, the estimate and cancel, and the annotate workspace mounts it from one line in `slide-stage.tsx`. The fake scene `scene=streaming` serves a run that finishes one tile per poll. AINUC-010 (whole-slide nuclei job UI) owns the fuller job controls.
- Cell edits through `CellEdits` do not apply to streamed tiles, because tile chunks number their cells inside the tile. Once the run ends, the finished result set opens through `PagedCells` as before.
- The scene has no vertex budget and holds each tile twice, as its parts and inside its merged block. A 250,000 nucleus run fits, but a 1.6 million nucleus run would sit far above the 4,000,000 vertices that ADR 0242 allows resident. TODO: hand a finished run over to `PagedCells`, or drop parts once their block is sealed, before streaming runs of that size.
- The engine tests are `test/nuclei/streamed-scene.test.ts` and `test/nuclei/run-stream.test.ts`, and `browser/nuclei-stream.spec.ts` streams 250,000 nuclei through deck.gl and cancels a run in a browser.
