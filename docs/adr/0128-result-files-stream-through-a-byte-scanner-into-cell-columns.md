# 0128. Result files stream through a byte scanner into cell columns, and the worker writes chunks from those columns

- Date: 2026-11-01
- Status: Proposed
- Deciders: agent (RSET-012), waiting for the owner
- Backlog: RSET-012 (large result files in bounded memory), touches RSET-011 (cells from imported files), AIP-013 (result chunk store) and OPS-002 (deploy definitions, which writes the Modal app for ingest)

## Context

RSET-011 (cells from imported files) read a result file as one bytes object, decoded it into one tree of Python objects, built a shapely geometry and a `ResultObject` per cell, turned every cell into a `Cell` with its outline as a list of Python floats, and built every chunk in memory before writing any. On the synthetic 900 MB GeoJSON of 1,607,244 cells that took about two minutes and 6 GB of memory ([cell import result](../results/2026-11-01-cell-import.md)). The ingest worker will run on Modal, which bills memory by the GiB-second for the larger of the request and the use, and a container that passes its hard limit is killed. RSET-012 (large result files in bounded memory) asks for the same file to import through the real worker within a memory ceiling, with the features read in batches and a lease that never lapses.

Two choices had to be made that affect other code: how to read a JSON file in batches, and where the chunk writer for imported cells lives, since `parfocal_common.chunk_store.build_cells` takes `Cell` objects and py-common has no numpy.

## Options considered

Reading JSON in batches:

1. A hand-written byte scanner in `parfocal_ingest.json_stream` that finds the item boundaries of one top-level array (`features` in GeoJSON, `objects` in Parfocal JSON, or a top-level list) with numpy over 1 MiB blocks, tracking strings, escapes and depth, and hands each block's items to `msgspec.json.decode` as one array. No new dependency, and msgspec still checks every byte, because every item and the rest of the document, with the array emptied, are decoded by msgspec. It is about 230 lines that this project must keep correct.
2. ijson with its yajl2_c backend. A mature library, but a new dependency with a C extension, and it builds Python dicts that must then be converted to the msgspec structs. On a 52 MB file of 100,016 features it took 0.53 s against 0.33 s for msgspec on the whole file and 0.57 s for the scanner plus the batch decodes, measured once on the machine of the [bounded cell import result](../results/2026-11-01-bounded-cell-import.md).
3. Keep the whole-file decode and only free memory sooner. The decoded tree alone is several times the file size, so no ceiling near the file size can hold.

Writing chunks from imported cells:

1. A columnar writer in the worker, `parfocal_ingest.chunk_builder`, that takes numpy columns (numbers, flat float32 outlines with offsets, class, score, region, optional probabilities, alternative class and nucleus outlines) and writes the same `PFC1` chunks and summary file through `parfocal_common.cell_chunks.encode`. It builds and puts 32 chunks at a time, so finished chunks never pile up. A test checks that it writes byte-identical files to `build_cells` for the same cells.
2. Give py-common a numpy dependency and make `build_cells` itself columnar, so there is one writer. The API image would carry numpy only for this, and every API test that builds chunks from `Cell` values would change.
3. Keep `build_cells` and feed it `Cell` objects in slices. Each `Cell` holds Python lists, which is where most of the memory went, and a summary over all cells still needs every cell at once.

## Decision

Option 1 for reading and option 1 for writing.

- The readers keep their whole-file functions (`read_geojson`, `read_parfocal_json`, `read_table`) for small files and tests, and gain streams (`stream_geojson`, `stream_parfocal_json`, `stream_table`) that yield one `ReadResult` per batch. Both share the per-feature code. The stream builds the polygons of a batch with shapely's vectorised calls when a feature is a plain one-ring polygon, and falls back to `shape()` one by one otherwise, and a test checks both give the same geometry.
- The import reads the downloaded file from disk and never holds it in memory. `CellCollector` turns each batch of cells into columns, writes them to files in the job's work folder, and reads them back once at the end, so a column is never held twice. Regions and zones stay `ResultObject`s, since a file has few.
- The class list keeps the order RSET-011 (cells from imported files) gave it: declared classes, then the classes of regions and zones, of cells, and the probability keys of each. A file with more than 255 class names fails as before.
- Matching keeps the rule of [ADR 0127](0127-imported-cells-keep-numbers-by-centre-and-take-the-innermost-region.md) (imported cells keep their numbers by centre distance and take the innermost region), but `pair_centres` returns arrays instead of a dict of 1.6 million entries. It stays one search over the whole slide rather than one tile at a time, because matching 1.6 million incoming cells against 1.6 million known ones added 135 MiB to the peak, which the ceiling allows, and a tile-by-tile search would have to treat cells near tile edges twice.
- The source file is kept with a server-side copy of the upload object instead of a second upload of its bytes.
- CPU work runs in threads, in slices of at most 65,536 cells or one 1 MiB block, so the event loop that renews the 60 s lease is never held up for long. In seven imports of the 1.6 million cell file through the real worker the lease never had less than 40 s left, the step took 42 to 45 s and the peak resident memory was 824 to 1,025 MiB, against about 110 s and 6 GiB before ([bounded cell import result](../results/2026-11-01-bounded-cell-import.md)).

## Consequences

- Two writers of one format now exist. `build_cells` stays for the API and its tests, and the ingest worker uses `chunk_builder`. `test_the_chunk_builder_writes_the_same_bytes_as_the_chunk_store` must pass whenever either changes. Decision 14c in [decisions.md](../decisions.md) asks whether py-common should take numpy and keep one writer.
- The JSON scanner is a parser that this project owns. Its tests decode random documents at block sizes of 1, 3, 64 and 1 MiB bytes and compare with msgspec on the whole document, and broken documents must fail.
- The memory ceiling for the worker is decision 14a, and the benchmark asserts the measured peak is under `INGEST_MEMORY_MIB` in `parfocal_ingest.settings`, which the Modal function of OPS-002 (deploy definitions) must use when it is written.
- CSV files were already read as rows but decoded as one string. They are now read from the file in batches of 20,000 rows, and an undecodable byte anywhere fails the file as unreadable, as before.
