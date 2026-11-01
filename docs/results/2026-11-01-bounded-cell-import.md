# Result: a 1.6 million cell GeoJSON through the real worker in bounded memory

- Date: 2026-11-01
- Backlog: RSET-012 (large result files in bounded memory)
- Kind: benchmark
- Commit: the RSET-012 (large result files in bounded memory) commit on top of `958de59`, measured as the working tree just before that commit with the same code
- Environment: MacBook Air, Apple M4, 24 GB memory, macOS 15.8.1, CPython 3.14.7, numpy 2.5.4, scipy 1.18.1, shapely 2.2.0, msgspec 0.21.1. Postgres 17.10 with PostGIS 3.6.1 behind PgBouncer 1.26.0 and MinIO from the local compose stack (`postgres`, `pooler` and `storage` services), bucket `parfocal-test`. The worker is `python -m parfocal_ingest` with its default workflows and the real 60 s lease, started as its own process
- Data: the same synthetic GeoJSON as the [cell import result](2026-11-01-cell-import.md), written by `workers/ingest/benchmarks/make_cells_geojson.py` from the POC's synthetic whole-slide job `synth0001503` (Huron-1-40x nucleus outlines tiled over the tissue of CAMELYON16 `tumor_009`): 901,125,253 bytes, 1,607,244 cells as QuPath-style features with a polygon outline, a class and a score, no nucleus outlines and no probabilities, and 16 regions in a 4 by 4 grid. No PHI. The file was written to the session scratchpad and deleted after the runs

## Question

Does the synthetic 1.6 million cell file import through the real worker process, against MinIO and Postgres, within a memory ceiling small enough for a cheap Modal container, and does the job keep its lease, so that it is claimed once? RSET-011 (cells from imported files) measured about 110 to 120 s and a peak resident memory of 6.0 to 6.4 GiB for the same file in the worker's code path, without the database, the download or a lease.

## Method

`test_benchmark_a_large_result_file_through_the_real_worker` in `apps/api/tests/test_large_result_imports.py` is the benchmark. It runs only when `PARFOCAL_BENCH_RESULT_FILE` names a file, and writes its numbers as JSON to `PARFOCAL_BENCH_OUT`.

```sh
uv run python workers/ingest/benchmarks/make_cells_geojson.py <scratch>/cells-all.geojson 2000000
PARFOCAL_BENCH_RESULT_FILE=<scratch>/cells-all.geojson PARFOCAL_BENCH_OUT=<scratch>/run.json \
  uv run pytest -q -m db apps/api/tests/test_large_result_imports.py -k benchmark -p no:logging
```

1. A fresh migrated database, a workspace with a project and a slide without a pixel size, so cells match within 16 pixels.
2. The file goes through the upload API in 64 MiB parts into MinIO, as a result upload paired with the slide, which queues the result import job. The test raises the upload limit to 4 GiB for this.
3. The worker starts as `/usr/bin/time -l python -m parfocal_ingest --database-url ... --worker first --idle-exit 2 --poll 0.1 --workspace <tenant>` with `STORAGE_*` and `INGEST_WORK_DIR` in its environment. As soon as the job shows `claimed_by = first`, a second worker named `second` starts with the same options and polls every 0.1 s, so it would take the job the moment the first worker's lease lapsed.
4. Every 0.25 s, until the job is done, the test reads `claims`, `claimed_by`, `status` and `lease_until - clock_timestamp()` from a separate connection.
5. The step time is `finished_at - started_at` of the job's one step. The peak memory is the "maximum resident set size" that `/usr/bin/time -l` prints for the first worker, in bytes, which covers the download, the parse, the matching, the chunk writes, the source copy and the database writes. `/usr/bin/time` also prints macOS's "peak memory footprint", which counts only the process's own dirty memory.
6. The same file is uploaded again to the same slide and imported the same way, which is a second import whose cells all inherit their numbers from the first set.
7. Every object under the tenant's prefix is deleted.

The run was repeated three times. A first version of the benchmark, which imported the file once, ran once before them on the same code and is listed as run 0.

The in-process script `workers/ingest/benchmarks/measure_cell_import.py`, updated to the new code path, ran once on the same file for the time per stage, without the worker, the database or the download.

## Results

Every import ended `done` with `claims = 1`, `claimed_by = first`, the upload `ready`, 1,607,244 cells in 1,683 chunks and 16 regions. No sample saw a lapsed lease, and the second worker never took a job. Every second import inherited 1,607,244 of 1,607,244 numbers. Every run deleted all its objects afterwards (1,685 after run 0 and 3,370 after each two-import run).

First import through the worker:

| Run | Step seconds | Worker wall seconds | Worker user CPU seconds | Peak RSS MiB | Peak footprint MiB | Lowest lease left, seconds | Lease samples |
|---|---:|---:|---:|---:|---:|---:|---:|
| 0 | 43.14 | 46.48 | 35.03 | 1,015 | 578 | 40.02 | 157 |
| 1 | 41.70 | 45.16 | 35.01 | 1,025 | 583 | 40.08 | 152 |
| 2 | 43.76 | 47.28 | 35.94 | 828 | 711 | 40.06 | 160 |
| 3 | 42.30 | 45.82 | 35.40 | 824 | 709 | 40.04 | 154 |

Second import of the same file to the same slide:

| Run | Step seconds | Worker wall seconds | Worker user CPU seconds | Peak RSS MiB | Peak footprint MiB | Lowest lease left, seconds | Lease samples |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | 45.01 | 48.67 | 36.72 | 951 | 660 | 40.20 | 164 |
| 2 | 44.29 | 47.93 | 36.75 | 944 | 690 | 40.14 | 161 |
| 3 | 43.02 | 46.55 | 36.64 | 950 | 692 | 40.03 | 157 |

The worker wall time runs from the worker's start to its exit, so it includes the Python start, the claim and the 2 s idle exit after the job.

Compared with the [cell import result](2026-11-01-cell-import.md) of RSET-011 (cells from imported files) on the same file:

| | RSET-011, in process, no database | RSET-012, real worker |
|---|---:|---:|
| Time | 109.83 to 119.70 s | 41.70 to 45.01 s per step |
| Peak RSS | 6,174 to 6,351 MiB | 824 to 1,025 MiB |

The in-process script, one run on the same file and code, without the database, the download or the worker:

| Stage | Seconds | Peak RSS MiB after it |
|---|---:|---:|
| Stream the file into cell columns | 18.45 | 756 |
| Class list | 0.00 | 756 |
| Match regions, first import | 0.00 | 756 |
| Match cells, first import | 0.21 | 756 |
| Cell table with innermost region | 0.38 | 786 |
| Plan chunks | 0.39 | 895 |
| Build and write chunks to MinIO | 15.84 | 982 |
| Read the older summary from MinIO | 0.10 | 987 |
| Match cells, second import, all known | 1.46 | 1,122 |
| Total | 36.82 | |

Python heap, measured with `tracemalloc` on a 52,775,839 byte GeoJSON of the first 100,000 cells of the same POC job plus the 16 regions, one run each. `tracemalloc` sees Python and numpy allocations but not GEOS:

| Reader | Peak Python heap MiB | Heap left at the end MiB |
|---|---:|---:|
| `read_geojson` on the whole file plus `outlines` of all cells, the RSET-011 path | 474.1 | not measured |
| `read_path`, the stream into cell columns | 45.6 | 17.3 |

`test_reading_100000_cells_stays_within_a_bounded_python_heap` in `workers/ingest/tests/test_cell_import.py` checks the stream in CI on 100,000 generated eight-vertex cells against a 64 MiB limit.

Reading JSON in batches, one run each on the 52,775,839 byte file of 100,016 features, decoding only, without geometry:

| Way | Seconds |
|---|---:|
| `msgspec.json.decode` of the whole file, then `msgspec.convert` of the features | 0.33 |
| ijson 3.6.0 with the yajl2_c backend, `items(handle, "features.item", use_float=True)` | 0.53 |
| The byte scanner of `parfocal_ingest.json_stream` with `msgspec.json.decode` of each batch, with 4 MiB blocks before the block size was set to 1 MiB | 0.57 |

The ijson run used a throwaway virtual environment in the session scratchpad, and ijson is not a dependency of the repository.

## Interpretation

- Facts: the peak resident memory of the worker stayed between 824 and 1,025 MiB over seven imports, about a sixth of the RSET-011 peak, and the step took 42 to 45 s, about 2.6 times faster. The lowest lease left was 40.0 s every time, which is the 60 s lease minus the 20 s between renewals, so every renewal arrived on time while the step ran, and the competing worker never claimed.
- The stream itself holds little. Python's heap stayed under 46 MiB for 100,000 cells, and the resident memory of the in-process script grew from about 210 MiB of imported libraries to 374 MiB while it read all 1.6 million cells (seen once in a trace of the reading stage alone). What remains is about 8 bytes per outline vertex, 30,339,178 vertices here, plus the per-cell columns, the matching and the summary file.
- The second import used about the same memory as the first, 944 to 951 MiB in the worker. In the script, where both imports share one process, matching against the 1.6 million known cells added 135 MiB to the peak.
- Assumption: macOS counts a process's resident memory differently from Linux and from Modal's sandbox. The "peak memory footprint" macOS also reports was 578 to 711 MiB. The peak RSS is the safer of the two numbers for a ceiling, and it must be measured on Modal (TODO).
- Assumption: a real QuPath export of a whole slide would need more, because each cell also carries a nucleus outline, which the columns keep. Its 30 or so measurements per cell are dropped batch by batch and add nothing.
- The time on Modal is unknown (TODO), because Modal's CPUs are not an M4. At the published price of $0.00000222 per GiB per second for memory, a 47 s run costs $0.00010 at 1 GiB, $0.00021 at 2 GiB and $0.00042 at 4 GiB in memory, and Modal bills the larger of the request and the use.
- The byte scanner was slower than ijson by 0.04 s on 52 MB in decoding alone, which is small next to the 18 s the reading stage takes for the whole file, most of it in building geometries and outlines.

## Follow-ups

- [ADR 0128](../adr/0128-result-files-stream-through-a-byte-scanner-into-cell-columns.md) (result files stream through a byte scanner into cell columns) relies on these numbers.
- Decision 14a in [decisions.md](../decisions.md) picks the memory of the Modal ingest container from them.
- TODO: repeat on a Modal container once OPS-002 (deploy definitions) writes the ingest function, because Linux counts memory differently from macOS and Modal's CPUs are not an M4.
- TODO: repeat with a real QuPath export of a whole slide, which carries a nucleus outline and about 30 measurements per cell. The nucleus outlines add to the columns, the measurements are dropped batch by batch.
