# 0127. Imported cells keep their numbers by centre distance read from older summaries, and each cell takes the innermost region its centre lies in

- Date: 2026-11-01
- Status: Accepted
- Deciders: agent (RSET-011), waiting for the owner
- Backlog: RSET-011 (cells from imported files), touches RSET-012 (large result files in bounded memory), OBJ-002 (IDs across result sets) and GUIDE-012 (least sure first order)

## Context

RSET-011 (cells from imported files) writes the cells of an imported GeoJSON, QuPath export, Parfocal JSON or CSV into the chunks of [ADR 0126](0126-cell-chunks-in-object-storage-with-a-summary-index.md) (cell chunks in object storage with a summary index). Three things had to be settled that no earlier record fixes.

1. How a cell of a new set finds the cell of an older set on the same slide whose number it inherits. [ADR 0071](0071-object-id-grammar.md) (object ID grammar) says cells match one to one, best first, when their centroids are at most 4 µm apart, or 16 pixels without a pixel size, and OBJ-002 (IDs across result sets) built that as `match_cells` over shapely geometries. Older cells now live only in chunk files in object storage, not in the database, and a whole slide can hold 1.6 million of them, so the rule must not compare every pair and must not need every older chunk.
2. Which region a cell belongs to. The chunk field `region` holds one T number, and regions of one file may overlap or nest.
3. What happens to files and fields the chunk format cannot hold as they are: a file of only cells, which RSET-004 (pairing results with slides) refused with `result-cells-only`, a point cell with no outline, a cell without a score, and probabilities on only some cells.

## Options considered

Matching:

1. Read the `x`, `y` and `number` fields of each older set's summary file, one GET per set, and match centres with a KD-tree pair search inside the worker. One file per set, no extra table, and the same rule as ADR 0071. The centre must be computed the same way on both sides.
2. PostGIS on centroids, one chunk at a time. It needs the older centres in the database, which ADR 0126 kept out of it, or a temporary table of 1.6 million points per import, and the database would do work the worker does in a second.
3. Match by outline overlap (IoU 0.5), as regions do. It reads every older chunk, intersects polygons, and a re-run of a detector that moves an outline by a pixel can drop a small cell below the threshold while its centre barely moves.

Region of a cell:

1. The innermost region, the smallest by area among this set's regions that contain the cell's centre, with a centre on an edge counted as inside and the lower number winning a tie. A nested region, such as a tumour nest inside a tissue outline, is the more specific context.
2. The largest region, which is the lowest number since regions are numbered largest first. The display `T1·C145` would then name the outer outline for every cell.
3. The `parent` a file names. Only Parfocal JSON carries it, QuPath exports do not, and it can name a region the reader skipped.

## Decision

Option 1 for matching and option 1 for the region.

- A cell's centre is the mean of the vertices of its float32 outline, the value `chunk_store.placed` already writes into the summary file. It is not shapely's area centroid, so a second import of the same file computes exactly the centres the first one stored and every cell inherits its number. A point cell's centre is the point.
- `parfocal_ingest.matching.match_centres` takes the known numbers and centres and the incoming centres as arrays. `scipy.spatial.KDTree.sparse_distance_matrix` lists every pair within the distance, the pairs are sorted by distance, then known index, then incoming index, and one greedy pass keeps the best pair for each side. New cells take numbers from `slide_counters` in reading order of their centres, top to bottom and then left to right. `match_cells` of OBJ-002 (IDs across result sets) now calls it, so there is one rule. On 1,607,244 cells the second import matched every cell in 1.8 s ([result](../results/2026-11-01-cell-import.md)).
- The known cells are those of every ready, undeleted set on the slide with cells, read from their summary files in the order the sets were made, and the latest set wins when two sets carry the same number, as `known_objects` does for regions. A set whose summary file is missing or cannot be read adds no known cells, so its cells cannot pass their numbers on, and the import still succeeds.
- A cell's region is the innermost region of the same set that its centre lies in, found with one STRtree query over all centres. Zones never count, and a cell outside every region, or in a file without regions, has region 0. Regions of older sets do not count, because a cell's region describes the set it belongs to.
- A file of only cells imports, and `result-cells-only` is gone. The status notice `cells-not-imported` is gone too, because every readable cell is now imported.
- A point cell is stored as a one-vertex outline. A polygon cell keeps its outer ring without the closing vertex and drops its holes, and a multipolygon keeps its largest part. A QuPath nucleus outline is stored as the cell's nucleus.
- A cell without a score is stored with score 0, because the chunk format has no missing score. A "cells below a score" scope therefore takes every unscored cell. Decision 13c asks the owner whether that is right.
- Probabilities are written only when every cell has them. When only some have, none are kept and the status shows `cell-probabilities-dropped`, because the chunk writer refuses a mix.
- The chunk files and the summary are written inside the import's transaction, before the set becomes ready, so a task made right after the import never meets `result-files-missing`. A crash before the commit leaves files under the set's prefix with no rows, and the rerun writes the same keys with the same bytes, because the set's id comes from the upload id, numbers come from `slide_counters` in the same rolled-back transaction, and gzip runs with the time set to 0.
- No migration was needed. Class counts per set now add each class's cells from the chunk entries to its regions.

## Consequences

- Sets imported before RSET-011 (cells from imported files) keep no cells. Uploading their source file again makes a new set with cells, and its regions keep their numbers through OBJ-002 (IDs across result sets).
- The 4 µm distance and the innermost rule are defaults until PROJ-008 (project settings) makes the distance a project setting, as ADR 0071 (object ID grammar) planned.
- A 900 MB GeoJSON of 1.6 million cells took about two minutes and 6 GB of memory in the worker's code path, most of it in the reader and the chunk writer, and it was not run through a real worker and its 60 s lease. RSET-012 (large result files in bounded memory) is added for that.
- Decisions 13a to 13d in [decisions.md](../decisions.md) ask the owner.
