# 0076. AI cells as binary chunks in object storage, regions and human annotations as PostGIS rows

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: STACK-021, ANN-020, RSET-001, RSET-003, OBJ-001, AINUC-003

## Context

A result set can hold over a million cells on one slide (POC doc 19 and doc 31), plus tens to thousands of regions, and people add regions of interest, measurements and their own objects. The viewer must page cells without holding every outline (doc 31 found that holding them all fails on every renderer), reviewers give verdicts per object ([ADR 0072](0072-verdicts-reasons-and-opinion-forms.md)), objects carry the IDs of [ADR 0071](0071-object-id-grammar.md), and imported AI output is immutable (RSET-001). The POC's paged format dropped the type probabilities, which confidence displays need (doc 33). The readers of [ADR 0070](0070-result-file-parsers.md) produce one object form for all of this.

## Options considered

1. The POC split, as the backlog default: human annotations in PostGIS with an append-only version table, model output as typed-array chunks per tile in object storage with a summary index, FlatGeobuf for export. Pages cheaply and keeps Postgres small. Needs its own binary format and two storage paths.
2. Everything in PostGIS. One store and spatial SQL for everything, but 1.6 million polygons per slide is about 30 million vertices per result set in Postgres (Neon storage is billed), every viewport becomes a query, and the browser still needs a compact wire format.
3. GeoParquet or FlatGeobuf files per job. Standard formats with spatial indexes, but the browser needs a Parquet or FlatGeobuf decoder in the worker, per-cell class probabilities do not map well onto FlatGeobuf properties, and neither gives a cheap all-cells summary for the overview.

## Decision

Option 1, with the formats below. A [spike](../results/2026-10-18-cell-chunk-paging-spike.md) paged 1,607,244 cells in Chromium with the overview ready in 77 ms locally and 3.3 s on a 100 ms, 50 Mbit/s link, detail views in under 0.5 s on that link, and at most 65 MB held, against the POC's 3.3 s local and 86 to 191 MB.

### Where each object lives

| Object | Store | Why |
|---|---|---|
| AI cells (C) | Chunks in object storage, one index row per chunk in Postgres | Up to millions per slide, read by viewport, immutable |
| AI regions (T) and unsure zones (Z) | PostGIS rows per result set, immutable | Thousands at most, needed by IoU matching (OBJ-002), staging and containment queries |
| Regions of interest (R), measurements (M), objects people add (T⁺, C⁺) | PostGIS rows with an append-only version table | Few, edited, audited |
| Heatmaps and masks | Rasters aligned to a slide level (ADR 0070) | Not objects |
| Verdicts | Rows keyed by result set, object kind and number (ADR 0072) | Never stored inside chunks, so AI output stays immutable |

Geometry everywhere is in level-0 pixels of the slide, with y down. PostGIS columns use SRID 0.

### The chunk container

Every chunk and summary is one file: the 4 bytes `PFC1`, a little-endian uint32 header length, a UTF-8 JSON header padded with spaces so the arrays start on an 8-byte boundary, then the arrays, each 8-byte aligned. The header holds `version` (1), `kind`, `count` and a `fields` list of name, numpy type (`u1`, `u2`, `u4`, `f4`), byte offset from the end of the header and element count. Readers map each field to a typed array view without copying and ignore fields they do not know, so fields can be added without a new version. Files are stored gzip-compressed and served with `Content-Encoding: gzip`, so the browser inflates them natively.

Cells are binned by centroid into a square grid of 2048 level-0 pixels per result set, and each non-empty grid cell is one chunk.

Chunk fields (`kind: "cells"`, one entry per cell unless noted):

| Field | Type | Meaning |
|---|---|---|
| `number` | u4 | The cell's C number from ADR 0071 |
| `offsets` | u4, count + 1 | Start of each cell's ring in `points`, in vertices |
| `points` | f4, 2 per vertex | Outer ring in level-0 pixels, not closed |
| `class` | u1 | Index into the result set's class list, 255 for unclassified |
| `score` | u1 | Detection score × 255 |
| `probs` | u1, count × classes | Type probabilities × 255, in class-list order. Absent when the source has none |
| `flags` | u1 | Bit 0 means the AI is unsure of this cell. The other bits are reserved |
| `region` | u4 | The T number of the region holding the cell, 0 for none |
| `nucleus_offsets`, `nucleus_points` | u4, f4 | Optional nucleus ring when the source has both cell and nucleus (QuPath) |

The header also carries `chunk` (its index), `tile` (x, y, width, height of the grid cell) and `classes` (the class count).

Summary fields (`kind: "cell-summary"`, one row per cell, rows in number order so row k is C(k+1)):

| Field | Type | Meaning |
|---|---|---|
| `x`, `y` | f4 | Centroid |
| `diagonal` | u2 | Bounding-box diagonal in level-0 pixels, for the 4 CSS pixel outline rule of doc 31 |
| `class`, `score`, `flags` | u1 | As in the chunk |
| `chunk` | u2 | Index of the chunk holding the cell |
| `index` | u2 | Position of the cell inside that chunk |

The summary header lists every chunk's `tile`, so the viewer knows what to fetch without another request.

### Rows in Postgres

- `result_chunks` per result set holds the chunk index, the tile box, the cell count, the vertex count, the number range and the object key, so the API can sign URLs for a viewport (TILES-001) and the importer can check totals.
- `result_objects` holds AI regions and zones: result set, kind, number, class, score, probabilities as a `smallint[]`, parent number and a PostGIS geometry with a GiST index.
- `annotations` holds what people make: slide, kind, number, person mark, class, geometry, properties, author and a current version. `annotation_versions` is append-only and keeps every change with who and when, so undo and audit can replay it. A delete is a version that marks it deleted.

## Consequences

- ANN-020 (annotation persistence API) builds `annotations` and `annotation_versions`. RSET-001 builds result sets with `result_chunks` and `result_objects`, and RSET-003 writes chunks from the ADR 0070 object form. OBJ-001 numbers cells before the chunks are written, because the summary order is the number order.
- AINUC-003 (chunk schema with probabilities) is answered by the chunk fields above. AI runs here write the same format as imports and always write `probs`, so its schema test fails when they are missing. Imported files may have none.
- Chunks live under the tenant's prefix in object storage. Signing and the CDN are TILES-001 and TILES-002. Locally they live on disk until the cloud is back.
- Export to GeoJSON and FlatGeobuf (ANN-024, RSET-008) reads chunks and rows and writes the ADR 0071 IDs in properties.
- The viewer (VIEW epic) reads chunks in a worker. Drawing cost was not measured here. TODO: the renderer benchmark (VIEW-039) uses this format and the doc 31 GPU numbers.
- TODO: an import with more than 50,000 regions on one slide may need region chunks too. That limit is an assumption. RSET-005 warns above it until a real file shows the cost.
- TODO: on links slower than 50 Mbit/s the 14 MB summary of a 1.6 million cell slide takes over 2 s. Splitting it by area or quantising positions is the next step if pilot sites need it.
