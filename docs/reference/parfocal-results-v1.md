# Parfocal results file, version 1

The native file for importing AI results ([ADR 0070](../adr/0070-result-file-parsers.md)). The schema is [parfocal-results-v1.schema.json](parfocal-results-v1.schema.json) (JSON Schema 2020-12) and a filled-in example is [parfocal-results-v1.template.json](parfocal-results-v1.template.json). The API serves both at `GET /api/result-formats/parfocal-json/schema` and `/template`.

## What a file holds

- `format` is always `"parfocal-results"` and `version` is `1`.
- `model` names the model (`name`, and optionally `version`, `run_at` and `parameters`).
- `slide` optionally helps pairing: `file_name`, `slide_id`, `width`, `height` and `mpp`.
- `coordinates` says how to read positions: level-0 pixels by default, or a `level` with its `scale` and an `offset`.
- `classes` lists class names with optional colours (`#rrggbb`), at most 64.
- `objects` holds regions, cells and zones. Each has a `kind`, a GeoJSON `geometry` (Point, Polygon or MultiPolygon), and optionally `source_id`, `parent` (the `source_id` of its region), `class`, `score` (0 to 1), `probabilities` (class name to 0 to 1) and free `properties`.
- `rasters` names heatmaps and masks sent next to the file, with their level and scale.

## Checking a file

Run `uv run python -m parfocal_common.results_schema FILE`, or send the text to `POST /api/result-formats/parfocal-json/validate` as `{"content": "..."}`. Both report every problem with its line, the path inside the file and one of these codes. The command exits with 1 when there are problems.

| Code | Meaning | Example |
|---|---|---|
| `not-json` | The text is not JSON, at the line where parsing stopped | a trailing comma |
| `wrong-format` | `format` is not `"parfocal-results"` | `"format": "geojson"` |
| `wrong-version` | `version` is not `1` | `"version": 2` |
| `missing-field` | A required field is missing, reported at its parent | `model` without `name` |
| `unknown-field` | A field the format does not know | `"colour"` at the top |
| `wrong-type` | A value of the wrong JSON type | `"geometry": "here"` |
| `out-of-range` | A number outside its range | `"score": 1.5` |
| `bad-length` | A text or list that is too long or too short | a class name over 120 characters |
| `not-allowed` | A value that is not one of the allowed ones | `"kind": "nucleus"` |
| `bad-pattern` | A text in the wrong shape | `"color": "red"` |

The check covers the structure only. Whether each geometry is valid and fits the slide is checked when the file is imported (RSET-005).
