# 0237. The client keeps the summary whole and pages full chunks under a vertex budget

- Date: 2026-11-06
- Status: Accepted
- Deciders: Claude
- Backlog: AINUC-005, AINUC-013, AINUC-010, JOBS-007

## Context

[ADR 0126](0126-cell-chunks-in-object-storage-with-a-summary-index.md) (cell chunks in object storage with a summary index) defined the files a result set is stored as. AINUC-005 (chunk paging in the client) is the first browser reader of them. A whole-slide run holds 1.6 million nuclei, about 30 million outline vertices, so the browser cannot hold every outline and cannot wait for them before showing anything. The paging spike ([result](../results/2026-10-18-cell-chunk-paging-spike.md)) and the POC's `paged-result.ts` and `paged-loader.ts` set the numbers to match: 4,000,000 vertices of resident outlines, a view plus a quarter of margin, 8 chunks per request batch, and paging only above 200,000 nuclei.

## Options considered

How deletions and promotions are remembered while chunks come and go:

1. In a separate `CellEdits` keyed by cell number. A number is the same in the summary, in every chunk and in the database, so an edit survives eviction, a reload of the chunk, and a set that is paged again from scratch.
2. Per chunk index and position inside the chunk, as the POC did. A position means nothing once the chunk is gone and depends on the order the writer chose.
3. Written into the resident chunk. It is lost at the first eviction.

How much of a chunk stays resident:

1. Copy out only what the viewer reads (number, offsets, outline points, class, score, flags, probabilities, alternative class) and drop the region numbers and nucleus rings. The inflated download buffer is freed, and the budget counts the vertices that remain.
2. Keep views over the inflated buffer. Everything stays addressable, but a chunk holds its whole download and the vertex budget no longer bounds memory.

Where decoding runs:

1. On the main thread, with the browser or `DecompressionStream` inflating natively. The measured longest task in the browser test is under the 50 ms long-task threshold.
2. In a worker. More code and a copy of the summary across threads, for a cost nobody measured.

## Decision

Option 1 in each case.

- `PagedCells.open` fetches the summary, inflates it, parses its columns as typed array views and keeps it for the life of the result. It pages when the set has more than 200,000 cells and otherwise loads every chunk, nearest first.
- `show(view)` adds a quarter of margin on each side, keeps the chunks that touch it, fetches the missing ones nearest first in batches of 8, and after each batch evicts the least recently used chunks outside the view until the resident vertices are within the budget (4,000,000 by default). A chunk in view is never evicted, so a view larger than the budget is drawn whole and goes over it.
- A newer `show` stops the older one after its current batch and decides what to keep. Two views that want the same chunk share one request.
- `cell(number)` looks one cell up through the summary row, loading its chunk if it is not resident.
- Readers check `version`, skip unknown fields and take `number` from the summary when it is present and from the row otherwise, as ADR 0126 asks. Summary and chunk readers live in `packages/viewer-engine/src/nuclei` and are tested against files written by the Python chunk store.

## Consequences

- AINUC-013 (stream a whole-slide run onto the open slide), AINUC-010 (whole-slide nuclei job UI) and JOBS-007 (run a model on a selection in Annotate) draw from `forEachLive` and the summary columns. Drawing is not part of this task.
- Nucleus rings, region numbers and the summary-only fields are not resident per chunk. A feature that needs them reads the chunk again or extends `CellChunk`.
- A promotion here is only a class set by the person on a cell number. Saving edits to the server belongs to the annotate tasks.
- The summary is held whole: 1,607,244 cells with five classes and probabilities are 42 MB in memory. A bigger set or a nine class set grows it. TODO: if that stops fitting a pilot machine, quantise x and y or split the summary by region, as the paging spike suggested.
- The time and memory budgets are rows in `perf-budgets.json` and checked by `packages/viewer-engine/browser/nuclei-paging.spec.ts`.
