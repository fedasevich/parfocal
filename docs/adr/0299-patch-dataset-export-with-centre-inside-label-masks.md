# 0299. Patch dataset export with centre-inside label masks

- Date: 2026-11-13
- Status: Accepted
- Deciders: Claude
- Backlog: EVAL-015

## Context

[ADR 0262](0262-training-dataset-export-as-a-zip-of-qupath-geojson.md) (training dataset export as a zip of QuPath GeoJSON) exports the signed-off objects of an annotate task, which [ADR 0237](0237-annotate-tasks-on-one-shared-layer.md) (annotate tasks on one shared layer) keeps on one shared layer. Segmentation training also wants image tiles with a label mask per tile. Reading a whole slide takes minutes, so it cannot run inside a request, and the mask rule decides which pixels each class owns, which training code outside Parfocal depends on.

## Options considered

| Option | For | Against |
| --- | --- | --- |
| 1. An ingest worker job writing one zip of tiles, masks, an index CSV, the GeoJSON per slide and a manifest, with a pixel labelled when its centre lies inside a shape | Runs where the slide readers are, every mask can be checked against its GeoJSON exactly, one download | The zip is built on the worker's disk |
| 2. The same job with masks drawn by a polygon fill such as OpenCV `fillPoly` | Fast | Edge pixels are filled whenever a shape touches them, so masks grow by up to a pixel and cannot be checked exactly |
| 3. Tiles cut on demand by the API | No stored zip | The API has no slide readers and would time out on large slides |

## Decision

Option 1. `POST /api/review-tasks/{task_id}/patch-exports` with a pyramid level and a tile size starts a `patch-export` job for people who see the whole task, and `GET /api/review-tasks/{task_id}/patch-exports/{job_id}` downloads the zip once the job is done.

- The objects come from the training dataset of ADR 0262, so only signed-off slides are exported, with `nothing-signed-off` when none are.
- The level is an index into the slide's own pyramid. A slide without that level is skipped as `level-missing`, and slides that are missing or cannot be read are skipped as `no-file` or `unreadable`. Tiles start at the top left and edge tiles are clipped to the level, not padded.
- Each tile has an RGB PNG and an 8-bit PNG mask. Background is 0 and every other pixel holds the class key. A pixel is labelled when its centre, mapped to level-0 pixels, lies strictly inside a shape, holes included.
- Only regions and cells are drawn, regions first and then cells, larger shapes before smaller ones, so the smaller and later shape wins an overlap. Regions of interest, marks and objects with no class are left out, and the unclassed count is written per slide.
- `index.csv` has one row per tile with the tile and mask paths, the slide, the level, the downsample, the level-0 position, the size and the class keys present. `manifest.json` holds the format and version, the task, the level, the tile size, the mask rule, the class snapshot, the slides with their GeoJSON paths, the skipped slides and the tile count.

## Consequences

- The test compares every mask with an independent even-odd ray cast over the GeoJSON in the zip, leaving out only pixel centres on a boundary.
- Large exports are bounded by the worker's disk and the zip upload. A tissue filter or a stride option can be added without changing the format.
