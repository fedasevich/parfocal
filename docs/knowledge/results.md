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

## The chunk codec lives in py-common

`parfocal_common.cell_chunks` writes and reads the `PFC1` container of [ADR 0076](../adr/0076-annotation-and-ai-result-storage.md) without numpy: `field(name, type, values)` takes anything with the buffer protocol (an `array.array` or a numpy array), `encode` aligns every field to 8 bytes after the header, and `decode` returns `memoryview`s cast to the field type, so a reader copies nothing. `problems_with(header, arrays, from_run=...)` names every missing, mistyped or miscounted field. A chunk from a model run must carry `probs`, one byte per cell and class, while an imported chunk may leave them out. It refuses a big-endian machine, because the format is little-endian and the browser reads it as such.
