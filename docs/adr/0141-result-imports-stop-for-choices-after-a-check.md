# 0141. A result import checks the file first and stops for the uploader's choices before it writes anything

- Date: 2026-11-02
- Status: Proposed
- Deciders: Yurii Fedas (to confirm)
- Backlog: RSET-005 (import checks and fixes), INGEST-022 (per-file problems in the Check step)

## Context

RSET-005 (import checks and fixes) asks that unreadable objects, objects without a class, classes the project does not know, missing scores, a heatmap's level and a file outside its slide each be shown with a fix before the result lands. [ADR 0125](0125-result-files-pair-in-python-and-import-as-their-own-job.md) (result files pair in Python and import as their own job) imported a paired file at once and skipped what it could not read with a notice. An imported set is immutable ([ADR 0077](0077-result-sets.md), result sets), so a fix after import means a new upload.

## Options considered

| Option | For | Against |
|---|---|---|
| 1. The import job reads the file, stores the problems on the upload and ends without writing. A route takes the choices and queues the job again | One reader, one place that knows the formats, nothing half written | The file is read twice when it has problems |
| 2. Import with defaults and report the problems afterwards | One pass | Wrong classes or scores land in an immutable set and must be uploaded again |
| 3. Check in the browser before upload | Instant | A second parser for every format, and masks and large files cannot be read in the page |

## Decision

Option 1.

- The `result-import` job reads the file with the readers of [ADR 0070](0070-result-file-parsers.md) (result file parsers) and a tally in `parfocal_ingest.import_checks`. A file whose every object lies outside its slide fails with `result-outside-slide` and changes nothing. Otherwise, when the upload has no choices yet and the tally finds `objects-unreadable`, `objects-without-class` (some classed, some not), `classes-unknown` (only when the project has classes), `scores-missing` (some scored, some not) or `objects-outside-slide`, the job stores them in `uploads.import_problems` and ends. Problems hold codes, counts, up to 200 places such as `row 12` or `feature 4`, and class names, never the reader's raw message, which could quote a cell.
- `getUploadStatus` answers `waiting` with `needs-choices`. `getImportProblems` lists the problems with their messages, `downloadImportProblems` sends them as CSV, `chooseHowToImport` takes `score_default` (`none` or `one`), `unclassified_class_id` and `class_mappings`, writes the mappings through `rememberClassMappings` so later files use them silently, stores the rest in `uploads.import_choices` and queues the job again. Choosing means "import the other N". `leaveResultOut` ends a result that waits for a slide or for choices and deletes its file.
- Heatmaps (`.png`, `.tif`, `.tiff`) are accepted as `result_format` `heatmap`. The check guesses the level and microns per pixel from the raster's size against the slide's, assuming a pyramid that halves per level. Heatmap storage does not exist yet, so a chosen heatmap ends with `result-heatmap-not-stored`.

## Consequences

- Migration `uploads` gains `import_problems` and `import_choices`, and the `result_format` check allows `heatmap`.
- INGEST-022 (per-file problems in the Check step) and the project page show these problems in place. The share of objects on tissue for each guess is not computed yet.
- Missing scores count as no score unless the uploader picks 1.0. Decision TODO for the owner: whether the default should be 1.0.
- TODO: a task to keep heatmaps as rasters aligned to a level, so a chosen heatmap imports.
