# 0126. Cell chunks are written per result set under the slide's prefix, version 1 grows by optional fields, and the summary file indexes the chunks

- Date: 2026-10-31
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: AIP-013, RSET-011, AINUC-004, AINUC-005, TILES-001, GUIDE-012

## Context

AIP-013 (result chunk store) asks for typed-array chunks per tile in object storage with offsets, level-0 vertices, class, scores, type probabilities, alternative types and flags, a summary index, and a versioned schema. [ADR 0076](0076-annotation-and-ai-result-storage.md) (AI cells as binary chunks in object storage) defined the `PFC1` container, its chunk and summary fields and the 2048 pixel grid, and `parfocal_common.cell_chunks` could encode and decode it. Nothing wrote a whole set of chunks yet, and the API read chunk files from a local folder (`RESULT_STORE_DIR`) through the synchronous `ResultStore` of GUIDE-012 (least sure first order), while the ingest worker writes everything else to object storage. RSET-011 (cells from imported files) needs the API to read chunks from object storage before cells from an import can be reviewed.

Four facts shaped the choices:

- The POC's chunk carried `alt_types`, the class of a second typer, with 255 for none (`server/app/nuclei/wsi.py`, POC doc 29 on second opinions). ADR 0076 has no such field.
- ADR 0076 says readers ignore fields they do not know, so fields can be added without a new version, but it did not say when a version must change or what a reader does with an unknown one.
- ADR 0076 says summary row k is cell C(k+1). OBJ-002 (IDs across result sets) lets a set inherit the numbers of cells an older set shares, so the numbers inside one set are not 1 to n.
- No browser reader of chunks exists in `packages/viewer-engine`. The paging spike's reader lived outside the repository.

## Options considered

Where the per-chunk index lives:

1. In the summary file's header, which lists every chunk with its tile, cell count, vertex count, number range, class counts and unsure count, while `result_chunks` keeps the tile box, the counts and the key. The viewer gets the index with the one file it fetches first anyway, and the database keeps what its queries use, the tile box for scopes and the key for signing. No migration. The database cannot filter chunks by class without reading the summary.
2. New columns on `result_chunks` for the number range and class counts, in migration `0049`. SQL could pick chunks by class, but nothing asks for that yet, and the same numbers would live in two places.
3. A separate index file next to the chunks. A third copy and one more request before the first chunk.

How the API reads chunks:

1. An async `ResultStore` with `get` and `put` over the API's existing `ObjectStore`, and no local store. Tests and production read the same way, through MinIO locally and R2 in the cloud.
2. Keep the local folder as the default and add object storage beside it. Two paths, and the tests would prove only the one production does not use.

How alternative types are stored:

1. An optional field `alt_class` (u1, 255 for none) inside version 1, as ADR 0076's rule allows. Old readers skip it.
2. Version 2 for the new field. Every reader must learn a version for a field it can ignore.
3. No field, and derive the second most likely class from `probs`. This loses the second model's own answer, and imports without probabilities have none.

## Decision

Option 1 in each case.

### The schema and its version rule

- Every chunk and summary header carries `version`. Version 1 is ADR 0076's layout plus the optional fields below. `decode` refuses a missing or unknown version with `UnknownVersionError` ("This chunk has schema version 2, and this reader knows only 1") before it reads any field, and the API answers such a file with 409 `result-files-unreadable`.
- Within a version a writer may add a field only if it is optional, has a stated meaning when absent, and leaves every existing field's name, type, length and meaning alone. Readers skip names they do not know and types they do not know.
- A new version is needed when a field is removed, renamed, retyped or changes meaning, when an optional field becomes required, or when the container itself changes. A reader that supports a new version keeps reading the older ones.
- Chunk fields (`kind: "cells"`) are ADR 0076's required `number`, `offsets`, `points`, `class`, `score`, `flags` and `region`, and the optional `probs` (count times classes), `alt_class` (one per cell, 255 for none) and `nucleus_offsets` with `nucleus_points` (always together, an empty ring for a cell without one). The header holds `chunk`, `tile` and `classes`.
- Summary fields (`kind: "cell-summary"`) are ADR 0076's required `x`, `y`, `diagonal`, `class`, `score`, `flags`, `chunk` and `index`, and the optional `number` (u4), `probs` and `alt_class`. Rows are sorted by number, and `number` holds it. A reader of a summary without `number` takes row k as C(k+1), as ADR 0076 said. The writer always writes `number`, and writes `probs` and `alt_class` when the chunks have them.

### The summary index

The summary header holds `grid` and a `chunks` list. Each entry is `{"chunk", "tile": [x, y, width, height], "count", "vertices", "numbers": [first, last], "class_counts": [one per class], "unclassified", "unsure"}`, where `unsure` counts cells with flag bit 0. `result_chunks` rows stay as ADR 0076 and migration `0026` (result sets) made them, and `ChunkRow.of(entry)` turns an entry into a row. The number range ADR 0076 listed for the row lives in the summary entry instead.

### Keys and bytes

- A set's files live under `t/{tenant}/s/{slide}/results/{set}/`, next to the kept source file from RSET-004 (pairing results with slides): `chunk-00000.pfc` and on, numbered in reading order of their grid cells, and `summary.pfc`. The retention purge already deletes the slide's prefix, so the files go with the slide.
- Files are gzip level 6 with the gzip time set to 0, so writing the same cells twice gives the same bytes, and they are stored with `Content-Encoding: gzip` and `Content-Type: application/octet-stream`. `decode` accepts plain and gzip bytes, because httpx2 inflates such a body on read and a browser does the same.
- `write_cells` puts the chunks eight at a time and the summary last, so a summary in storage means every chunk is there.

### The writer

`parfocal_common.chunk_store.build_cells(tenant, slide, set, cells, classes)` takes `Cell` values, bins them by the vertex mean of their float32 ring, the centre `review_order` uses, and refuses with a `ChunkError` that names the cell: a number that is 0, above 4,294,967,295 or seen twice, an outline without whole x and y pairs or with a value that is not a number, a class or alternative class outside the set's classes, a score or flag outside a byte, probabilities of the wrong length, and probabilities on some cells but not others. A set has at most 255 classes, 65,536 chunks and 65,536 cells per chunk, because the summary's `chunk` and `index` are u2. `read_chunk`, `cells_in`, `read_summary` and `summary_of` read the files back.

## Consequences

- The API reads chunks through `ObjectResultStore(app.state.storage)`. `LocalResultStore`, the `RESULT_STORE_DIR` setting and the `.results` folder are gone. The reading detail in [ADR 0117](0117-review-order-is-stored-per-task-slide.md) (review order stored per task slide), a synchronous `get` over a local folder, is replaced by this record.
- RSET-011 (cells from imported files) calls `build_cells`, `write_cells` and `add_chunks` with `ChunkRow.of`. It should also add each class's cell count from the entries to the set's class `object_count`, which `finish` counts only for regions and zones today.
- AINUC-004 (summary points API) serves the summary file. With `number` and five classes of `probs` a row is 26 bytes instead of 17. TODO: measure the gzip size for 1.6 million cells against that task's 25 MB budget. Decision 12b in [decisions.md](../decisions.md) asks whether `probs` belong in the summary at all.
- AINUC-005 (chunk paging in the client) and any viewer reader must check `version`, skip unknown fields, read `number` when present, treat `alt_class` 255 as none and expect empty nucleus rings. Nothing in TypeScript changes now, because no reader exists.
- TILES-001 (signed access to slide bytes) signs the chunk and summary keys from the rows and the summary key from the set's prefix.
- A result set that is purged on its own, without its slide, still leaves its files, as the retention TODO in [knowledge/database.md](../knowledge/database.md) says.
- TODO: the writer is plain Python without numpy and was not timed. A model run of 1.6 million cells should measure it before AINUC work depends on it.
