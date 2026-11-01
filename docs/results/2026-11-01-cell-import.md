# Result: importing cells from a result file, from 81 to 1.6 million cells

- Date: 2026-11-01
- Backlog: RSET-011 (cells from imported files)
- Kind: benchmark
- Commit: the working tree of RSET-011 on top of `fb882b2`, committed unchanged as the RSET-011 feature commit
- Environment: MacBook Air, Apple M4, 24 GB memory, macOS 15.8.1, CPython 3.14.7, numpy 2.5.4, scipy 1.18.1, shapely 2.2.0, msgspec 0.21.1, one process. Object storage is the local compose MinIO (`storage` service) on 127.0.0.1:9000, bucket `parfocal-test`. No database in the staged run
- Data: the real QuPath 0.7.0 export `workers/ingest/tests/fixtures/results/qupath-0.7-cells.geojson` (81 cells and one region), and a GeoJSON generated into the session scratchpad from the POC's synthetic whole-slide job `synth0001503` (Huron-1-40x nucleus outlines tiled over the tissue of CAMELYON16 `tumor_009`, 1,607,244 cells), with each cell as a QuPath-style feature (`objectType: "cell"`, a polygon outline, `classification.name` from the POC type, `score` from the POC score), no nucleus outlines and no probabilities, plus 16 region annotations that tile the cells' bounding box in a 4 by 4 grid. No PHI. The generated file was deleted after the runs

## Question

How long does the RSET-011 (cells from imported files) import path take on the largest cell file available, and does matching a second import against an older set scale without a quadratic loop? The scenario is POC doc 31 (paging 1.6 million nuclei). There is no budget for import time yet, and the result import job's lease is 60 s.

## Method

No real QuPath export with more than 81 cells exists locally, and no large GeoJSON fixture exists in the repository or in `~/.cache/parfocal`. The only large cell data is the POC's synthetic job, stored as `.npz` chunks, so a converter wrote it out as one 901,125,253 byte GeoJSON FeatureCollection.

A script ran the worker's own functions in order on that file and timed each with `time.perf_counter`, reading the peak resident memory from `getrusage` after each stage:

1. Read the file and parse it with `read_file` (the RSET-003 GeoJSON reader).
2. `objects_to_import`, `class_list` and `incoming_cells` (outlines and vertex-mean centres).
3. `match_regions` and `match_centres` against nothing, as a first import does.
4. `cell_values` (innermost region per cell), `build_cells`, then `write_cells` to MinIO under a random tenant prefix.
5. As a second import of the same file: `read_summary` of the set just written from MinIO, then `match_centres` of every incoming cell against it, checking that every number is inherited.
6. Delete every object under the prefix and check that none is left.

The script does what the import step does inside its transaction, without the database, the upload download, the source file copy and the job engine. It ran three times on the 1.6 million cell file and once on the QuPath fixture. The QuPath fixture also runs end to end through the API, MinIO and the real worker in `apps/api/tests/test_imported_cells.py`.

```sh
uv run python workers/ingest/benchmarks/make_cells_geojson.py /tmp/cells-all.geojson 2000000
uv run python workers/ingest/benchmarks/measure_cell_import.py /tmp/cells-all.geojson
```

The runs used the same two scripts from the session scratchpad. They were tidied for lint and types before they were committed under `workers/ingest/benchmarks/`, with the same stages and the same file layout, and the tidied versions were checked on 1,000 cells and the QuPath fixture. The converter reads the POC job from `/Users/yuriifedas/WebstormProjects/poc/server/fixtures/wsi/tumor_009/synth0001503`, as [poc-reference.md](../project/poc-reference.md) describes, and never writes to it.

`test_matching_a_large_slide_is_not_quadratic` in `workers/ingest/tests/test_cell_import.py` checks the matcher alone on a grid of jittered centres. CI runs it at 200,000 cells with a bound of 10 µs per cell, and `CELL_IMPORT_CELLS=1600000` runs it at full size.

## Results

The 1.6 million cell file: 1,607,244 cells, 16 regions, 5 classes, 30,339,178 vertices, 1,683 chunks holding 117,692,645 gzip bytes and a summary file of 16,344,152 gzip bytes. Every run inherited 1,607,244 of 1,607,244 numbers on the second import and left no objects behind.

Seconds per stage:

| Stage | Run 1 | Run 2 | Run 3 |
|---|---:|---:|---:|
| Read file bytes | 0.34 | 0.26 | 0.26 |
| Parse GeoJSON | 64.94 | 61.25 | 67.82 |
| Split regions and cells | 0.16 | 0.12 | 0.15 |
| Class list | 0.28 | 0.26 | 0.28 |
| Outlines and centres | 5.73 | 6.15 | 6.57 |
| Match regions, first import | 0.00 | 0.00 | 0.00 |
| Match cells, first import | 0.25 | 0.25 | 0.25 |
| Cell values with innermost region | 2.67 | 2.70 | 3.18 |
| `build_cells` | 36.58 | 35.61 | 37.87 |
| `write_cells` to MinIO | 1.60 | 1.41 | 1.47 |
| Read the older summary from MinIO | 0.10 | 0.09 | 0.09 |
| Match cells, second import, all known | 1.76 | 1.73 | 1.76 |
| Total | 114.41 | 109.83 | 119.70 |

Peak resident memory, MiB, after the stage:

| After | Run 1 | Run 2 | Run 3 |
|---|---:|---:|---:|
| Read file bytes | 1,064 | 1,066 | 1,064 |
| Parse GeoJSON | 5,372 | 6,041 | 6,174 |
| Cell values with innermost region | 5,742 | 6,041 | 6,174 |
| `build_cells` | 6,351 | 6,322 | 6,174 |
| End | 6,351 | 6,322 | 6,174 |

The QuPath 0.7 fixture, one run: 209,289 bytes, 81 cells, 1 region, 2 classes, 1,172 vertices, one chunk of 12,380 gzip bytes and a summary file of 1,381 gzip bytes. Every stage took under 0.01 s except `write_cells` to MinIO at 0.02 s, 0.03 s in all, and the second import inherited 81 of 81 numbers. The peak resident memory was 212 MiB, most of it the imported libraries.

## Interpretation

- Matching is not the cost. A second import matched 1.6 million cells against an older set in under 2 s, and a first import in a quarter of a second, so the KD-tree pair search over summary centres scales as intended.
- The reader and the chunk writer are the cost. Parsing the GeoJSON takes over half of the time and builds a full tree of Python objects, which is where the memory goes, and `build_cells` turns every cell into Python arrays one by one.
- Assumption: a real QuPath export of the same slide would be larger, because it also carries a nucleus outline and about 30 measurements per cell, so these numbers are a lower bound for QuPath.
- Not measured: the database writes, the download from storage, the source file copy and whether the 60 s lease holds while one step runs for two minutes. The parsing and building run in threads, so the event loop that renews the lease is not blocked, but that has not been tried at this size.

## Follow-ups

- [ADR 0127](../adr/0127-imported-cells-keep-numbers-by-centre-and-take-the-innermost-region.md) (imported cells keep their numbers by centre distance and take the innermost region) relies on these numbers.
- RSET-012 (large result files in bounded memory) is added to read features in batches and to run the full file through the real worker with its lease. TODO: the memory ceiling of the Modal worker it must fit.
