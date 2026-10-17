# 0070. Result files are read with msgspec, shapely, the csv module, tifffile and OpenCV into one object form, with Parfocal JSON v1 as the native format

- Date: 2026-10-18
- Status: Accepted
- Deciders: Yurii Fedas (standing approval)
- Backlog: RSET-000 (research check for result sets and AI result import), shapes RSET-002 (Parfocal JSON schema and validator), RSET-003 (readers), RSET-005 (import checks) and STACK-021 (annotation and AI result storage model)

## Context

POC [doc 37](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/37-ai-results-review-rework.md) makes importing AI results made elsewhere a first-class path, in four kinds of file: Parfocal's own JSON, GeoJSON including QuPath exports, CSV or TSV of cells or detections with a column-mapping step, and masks or heatmaps as PNG or TIFF aligned to a slide level. Files can be large. The POC's whole-slide nucleus result has 1.6 million nuclei ([doc 31](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/31-culling-paging-and-decoder-stutter.md)). Errors must name the line or feature (RSET-005). The server already reads slides with OpenSlide, tiffslide and tifffile ([ADR 0043](0043-server-slide-reading.md)).

QuPath's current release is 0.7.0. Its documentation exports objects with File, Object data, Export as GeoJSON, or with `exportObjectsToGeoJson(..., "FEATURE_COLLECTION")`, and uses a FeatureCollection so that properties such as the classification travel with each shape ([QuPath docs](https://qupath.readthedocs.io/en/stable/docs/advanced/exporting_annotations.html)). Every QuPath object has a name, a region, a classification and a measurement list ([QuPath objects](https://qupath.readthedocs.io/en/latest/docs/concepts/objects.html)). Third-party readers and writers describe `objectType` values such as `annotation`, `detection`, `cell` and `tile`, an optional `nucleusGeometry` on cells, and a classification with a `name` and a `color` that is either an RGB array or one packed integer ([Xenium Ranger inputs](https://10xgenomics.com/support/software/xenium-ranger/latest/analysis/inputs/segmentation-inputs), [wsinfer](https://wsinfer.readthedocs.io/en/latest/_modules/wsinfer/write_geojson.html), [paquo](https://paquo.readthedocs.io/en/stable/_modules/paquo/pathobjects.html)). Those details are second-hand and must be checked against a real export.

## Options considered

### JSON and GeoJSON

1. The standard library `json` and hand-written checks. No dependency, but about twice as slow and every check written by hand.
2. Pydantic, which the API already uses. Good error paths, but the slowest of the three on hundreds of thousands of features.
3. msgspec typed decoding into structs. It validates the structure while it decodes, its errors give the path to the failing feature, and it was the fastest in the spike: 0.50 s for 200,000 cells against 1.10 s for `json.loads` ([result](../results/2026-10-18-result-parsers-spike.md)).

### Masks

1. scikit-image `find_contours`, which gives sub-pixel outlines of a probability map but must be run per label.
2. rasterio `features.shapes`, which groups pixels into polygons but brings GDAL into the API.
3. OpenCV `findContours` per label inside each label's bounding box from `scipy.ndimage.find_objects`, which keeps holes through the contour hierarchy and took 0.037 s for 3,000 labels in a 4096 by 4096 mask.

## Decision

Option 3 in both cases, with these readers in RSET-003.

| Kind | Read with | Notes |
|---|---|---|
| Parfocal JSON | msgspec structs matching the v1 schema | Draft schema in [parfocal-results-v1.schema.json](../reference/parfocal-results-v1.schema.json). RSET-002 publishes it with a template and the validator |
| GeoJSON and QuPath exports | msgspec structs, then `shapely` 2 for geometry checks and repair | A FeatureCollection, a bare feature array or a single feature. `objectType` `cell` and `detection` become cells, `annotation` becomes a region, `tile` is refused. `nucleusGeometry` is kept as the cell's nucleus. `classification.name` is the class, and `color` may be an array or a packed integer. Measurements may be an object or a list of name and value pairs |
| CSV and TSV | The `csv` module with `csv.Sniffer` for the delimiter | A column-mapping step names x, y, class, score and an optional polygon column. 1,000,000 rows took 0.76 s |
| Masks and heatmaps | tifffile for TIFF, Pillow for PNG, then numpy | A heatmap stays a raster aligned to a slide level with a scale. A class mask or instance mask is traced with OpenCV per label in its bounding box, and the binary shortcut is never used because it merges touching objects |

All readers produce one object form: kind (region, cell or zone), the source id, the class name, a score, optional class probabilities, the parent region, a shapely geometry in level 0 pixels, and the source properties. Rasters keep their level and scale. Errors carry the feature index, or the row number for CSV, so RSET-005 can name the line. Parfocal JSON v1 keeps the type probabilities that the POC's paged format dropped, as STACK-021 asks.

The new dependencies are msgspec, shapely, numpy, opencv-python-headless, scipy and Pillow, added to the worker that imports results, not to the API package, because imports run as jobs ([ADR 0044](0044-background-jobs-and-workflows.md)).

## Consequences

- RSET-003 adds the readers in the ingest worker with one fixture per kind, including a real QuPath 0.7 export. TODO: confirm `objectType`, the colour encoding and that coordinates are level 0 pixels against that export.
- RSET-002 turns the draft schema into the published one, with a template and a validator in the API and as a command line tool. The validator in the API checks the schema only, and reading geometry stays in the worker.
- STACK-021 decides how parsed objects are stored. The object form above is its input.
- TODO: set a server import budget per million objects in RSET-003, measured on a real file.
