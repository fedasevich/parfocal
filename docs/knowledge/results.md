# Result files

How imported AI results are read in `parfocal_ingest.results` ([ADR 0070](../adr/0070-result-file-parsers.md)) and kept across sets in `parfocal_ingest.matching` ([ADR 0071](../adr/0071-object-id-grammar.md)).

## msgspec below 0.20 sees no fields on Python 3.14

On Python 3.14 the annotations of a class are evaluated lazily, and msgspec 0.19 does not read them. A `msgspec.Struct` then has no fields at all (`__struct_fields__ == ()`), decoding succeeds and every attribute is missing, with no warning. The ingest worker pins `msgspec>=0.21`, the version the RSET-000 spike measured. Check `__struct_fields__` first when a struct behaves as if empty.

## What a real QuPath 0.7 GeoJSON export looks like

`workers/ingest/tests/fixtures/results/qupath-0.7-cells.geojson` was made by QuPath 0.7.0 itself, headless, from `CMU-1-Small-Region.svs` with the script next to it: `QuPath script -i <slide> -a <out.geojson> qupath-0.7-cells.groovy` (the binary is `/Applications/QuPath-0.7.0-arm64.app/Contents/MacOS/QuPath-0.7.0-arm64`). It settles the ADR 0070 TODO:

- Cells have `objectType: "cell"` and the region `annotation`. Every feature has an `id` (a UUID).
- `nucleusGeometry` is a member of the feature next to `geometry`, not a property.
- `classification` holds `name` and `color` as an RGB array. Older files may have a packed integer, which the reader also accepts.
- `measurements` is an object of name and value pairs in 0.7. Older exports use a list of `{name, value}`, which the reader also accepts.
- Coordinates are level-0 pixels, not microns.

## Masks are traced per label, never as one binary image

`read_instance_mask` traces each label inside its bounding box (`scipy.ndimage.find_objects`, then OpenCV), so touching objects stay apart. `read_class_mask` labels the connected parts of each class value first. Contour points are pixel centres, so a point is mapped to `(x + 0.5) * downsample` at level 0. A heatmap is kept as a raster with its level and downsample.

## The chunk codec and the chunk store live in py-common

`parfocal_common.cell_chunks` writes and reads the `PFC1` container of [ADR 0076](../adr/0076-annotation-and-ai-result-storage.md) without numpy: `field(name, type, values)` takes anything with the buffer protocol (an `array.array` or a numpy array), `encode` aligns every field to 8 bytes after the header, and `decode` takes plain or gzip bytes and returns `memoryview`s cast to the field type, so a reader copies nothing. `decode` raises `UnknownVersionError` for a missing or unknown `version` before it reads a field, and it skips field names and types it does not know. `problems_with(header, arrays, from_run=...)` names every missing, mistyped or miscounted field, optional ones included. A chunk from a model run must carry `probs`, one byte per cell and class, while an imported chunk may leave them out. It refuses a big-endian machine, because the format is little-endian and the browser reads it as such.

`parfocal_common.chunk_store` builds and stores a whole set ([ADR 0126](../adr/0126-cell-chunks-in-object-storage-with-a-summary-index.md), cell chunks in object storage with a summary index). `build_cells(tenant, slide, set, cells, classes)` takes `Cell` values, bins them by the vertex mean of their float32 ring into 2048 pixel tiles, and returns the gzip chunks, one `ChunkEntry` per chunk and the summary file. `write_cells(store, built)` puts the chunks eight at a time and the summary last. `read_chunk` and `cells_in` give the `Cell` values back, and `read_summary` and `summary_of` give the summary with its chunk entries. `ChunkRow.of(entry)` in `parfocal_api.result_sets` turns an entry into a `result_chunks` row.

- Keys are `t/{tenant}/s/{slide}/results/{set}/chunk-00000.pfc` and on, in reading order of the tiles, and `summary.pfc`, next to the kept source file. `result_set_prefix` in `parfocal_common.result_imports` makes the prefix.
- Version 1 grows only by optional fields with a stated meaning when absent. Anything else, a removed, renamed or retyped field, a new meaning or a field that becomes required, needs version 2. The optional chunk fields are `probs`, `alt_class` (the class a second typer gave, 255 for none, the POC's `alt_types`) and `nucleus_offsets` with `nucleus_points`. The summary adds `number`, `probs` and `alt_class`.
- Summary rows are sorted by cell number but are not C1 to Cn, because OBJ-002 (IDs across result sets) lets a set inherit numbers. Read `number`, and fall back to row k is C(k+1) only for a summary without it.
- The summary header's `chunks` list is the chunk index: tile, cell count, vertex count, first and last number, a count per class, unclassified and unsure. The database rows keep only the tile, the counts and the key.
- Probabilities are all or none for a set, because nothing in the format marks one cell's probabilities as missing. The writer refuses a mix, as it refuses duplicate numbers, classes outside the set's list and outlines without whole x and y pairs.
- Gzip runs with the time set to 0, so the same cells give the same bytes and a rerun overwrites with identical files.

## httpx2 inflates gzip objects on read

The chunk files are stored with `Content-Encoding: gzip`. httpx2 inflates such a body, so `ObjectStore.get_object` returns the plain `PFC1` bytes, and a test that compares stored bytes with the gzip it wrote fails. Compare decoded content, `head_object` sizes or the `content-encoding` header instead. `decode` accepts both forms.

## Exporting a reviewed layer

`GET /api/review-tasks/{task}/slides/{slide}/export` writes one reviewer's layer, or with `consensus=true` the consensus, as GeoJSON (the default) or as Parfocal JSON (`format=parfocal`). Each object keeps its full ID and path in `properties.parfocal`, with `changed` (`retyped`, `reshaped`, `added`), the AI class and the verdict, so the file reads back through `read_geojson` or `read_parfocal_json` with nothing lost. A reviewer exports only their own layer. Project owners and viewers export anyone's layer and the consensus.

The consensus keeps the AI regions whose consensus is agree, with the earliest saved reshape, and the objects reviewers added, merged across reviewers by the same rule as the evaluation (`SAME_ADDED`: regions overlapping by half their union, cells within 16 pixels, same class, different reviewers). `first_of_each_match` in `evaluation.py` keeps the earliest added object of each group, so the kept ID does not depend on UUID order.

## Imported files become result sets in the worker

`parfocal_ingest.result_import` turns a read file into a set through `parfocal_api.result_imports.store_result_set`, which calls `insert_result_set`, `add_regions`, `add_chunks` and `finish` from `parfocal_api.result_sets`. `insert_result_set` takes the tenant, actor and creator directly, because the worker has no principal, and `open_result_set` is now a wrapper for the routes. The class list is the file's declared classes, then the classes of its regions, zones and cells, then the keys of their probabilities, compared without case and cut to 120 characters. Scores and probabilities are stored times 255. Regions and zones are matched against the ready sets already on the slide with `match_regions` (OBJ-002, IDs across result sets), so an object that overlaps an older one keeps its number and new ones get the next numbers from `slide_counters`, largest first. The set's name is the Parfocal JSON `model.name`, or "GeoJSON import", "Parfocal JSON import" or "CSV import", never the file name, because the name column is operational and the file name is PHI. The API reads chunks from object storage through `app.results` since AIP-013 (result chunk store).

## Imported cells are written as chunks inside the import transaction

RSET-011 (cells from imported files) writes every cell of a file, as [ADR 0127](../adr/0127-imported-cells-keep-numbers-by-centre-and-take-the-innermost-region.md) (imported cells keep their numbers by centre distance and take the innermost region) decided. A file of only cells imports too.

- `parfocal_ingest.cell_import.outlines` turns all cell geometries into outlines with shapely's vectorised calls: a point is a one-vertex ring, a polygon keeps its outer ring without the closing vertex, and a multipolygon keeps its largest part. The centre is the mean of the float32 vertices, the same value `chunk_store` writes into the summary. Do not use shapely's `centroid` for cells: it is the area centroid, so a second import of the same file would not land on the stored centres.
- Numbers come from `match_centres` in `parfocal_ingest.matching`, which `match_cells` also calls. The known cells are the `number`, `x` and `y` fields of the summary file of every ready set on the slide with cells, latest set first per number. `KDTree.sparse_distance_matrix` lists the pairs within the distance, and it keeps pairs at distance 0, which an identical re-import is made of.
- `innermost_regions` gives each cell the smallest region of its own set whose outline intersects its centre, the lower number on a tie, and 0 outside every region. Zones never count.
- A cell without a score is stored as score 0, and probabilities are kept only when every cell has them, otherwise the status shows `cell-probabilities-dropped`.
- `finish(connection, set_id, class_cells)` adds each class's cells, summed from the chunk entries by `cells_per_class`, to the class counts of its regions.
- The chunks and the summary are written before the transaction commits, so a set is never ready without its files. A rolled-back import leaves files with no rows, and its rerun overwrites them with the same bytes.
- On 1.6 million cells the reader and `build_cells` take most of the time and memory, and the matching takes under two seconds ([result](../results/2026-11-01-cell-import.md)). RSET-012 (large result files in bounded memory) is the follow-up.

