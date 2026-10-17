# Result: Parsers for imported AI results on Python 3.14

- Date: 2026-10-18
- Backlog: RSET-000 (research check for result sets and AI result import)
- Kind: spike
- Commit: cd1bdfc (the spike ran outside the repository, in a throwaway environment)
- Environment: Apple M4 MacBook, macOS 15.8.1, CPython 3.14.7 through `uv run --no-project`. Libraries as installed by uv on 2026-10-18: msgspec 0.21.1, shapely 2.2.0, numpy 2.5.4, tifffile 2026.10.15, opencv-python-headless 5.0.0, scipy 1.18.1, scikit-image 0.26.0
- Data: synthetic only, made by the spike scripts with a fixed random seed (7). No slides and no PHI

## Question

Which Python parsers read imported AI results fast enough for a whole slide, and do they install on Python 3.14? The POC's largest case is about 1.6 million nuclei per slide ([doc 31](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/31-culling-paging-and-decoder-stutter.md)). There is no server-side budget yet.

## Method

1. GeoJSON: a FeatureCollection of 200,000 cells, each a 16-point polygon with a QuPath-style `objectType`, `classification` (`name` and an RGB `color` array) and a `measurements` object. The file is 112 MB. It was decoded with `json.loads`, with `msgspec.json.decode` untyped, and with `msgspec.json.Decoder` into typed structs, and then turned into shapely geometries with `shapely.polygons`. The best of three runs is reported.
2. Masks: a 4096 by 4096 `uint16` instance mask with 3,000 labelled discs of radius 5. Contours were traced with OpenCV per label over the whole image, with `scipy.ndimage.find_objects` and OpenCV inside each label's bounding box, and with OpenCV on the binary mask.
3. CSV: one million rows of `x,y,class,score` (33.4 MB) read with `csv.DictReader` and converted to floats, and `csv.Sniffer` run on the first 4 KB with comma and tab delimiters.

## Results

| Step | Time (s) |
|---|---|
| GeoJSON, `json.loads` | 1.10 |
| GeoJSON, `msgspec.json.decode` untyped | 0.53 |
| GeoJSON, `msgspec` typed into structs | 0.50 |
| 200,000 polygons, `shapely.polygons` | 0.52 |
| Mask, OpenCV per label over the whole image | 12.52 |
| Mask, `find_objects` and OpenCV per label in its box | 0.037 |
| Mask, OpenCV on the binary mask | 0.006 |
| CSV, `csv.DictReader` over 1,000,000 rows | 0.76 |

The per-label box method found 3,002 contours for 3,000 labels, and the binary method found 2,899. `csv.Sniffer` picked the right delimiter for both comma and tab.

## Interpretation

- Every library installed from wheels on CPython 3.14.
- Typed msgspec decoding validates the structure and is still about twice as fast as untyped stdlib `json`. At this rate 1.6 million cells would take about 4 s to decode and 4 s to build geometries. That is an extrapolation, not a measurement.
- Instance masks must be traced per label inside each label's bounding box. Tracing the binary mask is faster but merges touching objects, which changes the object count.
- The standard library reads CSV fast enough, so no dataframe library is needed for import.

## Follow-ups

- [ADR 0070](../adr/0070-result-file-parsers.md) names the parsers.
- TODO: RSET-003 (readers) repeats the GeoJSON run on a real QuPath 0.7 export and a real CAMELYON or PanNuke-sized file, and sets a server budget.
