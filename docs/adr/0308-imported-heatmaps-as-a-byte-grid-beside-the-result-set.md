# 0308. An imported heatmap is kept as a gzip byte grid with a facts file under its result set

- Date: 2026-11-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: RSET-013 (heatmap storage and the import check leftovers). Changes [ADR 0141](0141-result-imports-stop-for-choices-after-a-check.md) (result imports stop for choices after a check), which ended a chosen heatmap with `result-heatmap-not-stored`. Builds on [ADR 0126](0126-cell-chunks-in-object-storage-with-a-summary-index.md) (cell chunks in object storage with a summary index) and [ADR 0158](0158-heatmap-colormaps-and-threshold.md) (heatmap colormaps and threshold).

## Context

A heatmap upload (`.png`, `.tif`, `.tiff`) was checked against its slide and then refused, because nothing could keep it. The viewer engine already draws a heatmap from a `HeatmapGrid` of width, height and one `Uint8Array` or `Float32Array` value per cell over a slide area. Imported cells already live in object storage under the result set prefix, gzip-packed and written through `ObjectResultStore`. The alternatives were a new database table of raster tiles, an OME-Zarr pyramid per heatmap, or a single grid object beside the set.

## Decision

- A heatmap is decoded in full at check time with tifffile or Pillow. A file that fails to decode, has more than two dimensions after squeezing, or holds no numbers ends with `result-heatmap-unreadable`.
- The check offers a list of guesses. The fitted guess (level and scale from the raster's size against the slide) comes first, then every other pyramid level. Each guess carries `tissue_share`, the share of the heatmap's value that lands on the slide's stored tissue mask (`tissue.png`, 64 pixel cells) when placed at that scale. Without a mask the share is null. When no level fits the shape, the levels are ranked by share.
- Accepting the choices takes the first guess saved with the problems. A heatmap with no guess ends with `result-heatmap-unplaced`.
- The values are stored as one row-major `uint8` grid, gzip-packed, at `{result set prefix}heatmap.bin`. Bytes stay as they are, other integers scale by their type's maximum, floats clip to 0 to 1, and booleans become 0 or 255. A JSON facts file at `{result set prefix}heatmap.json` holds width, height, level, downsample, microns per pixel, tissue share and the grid key. The source file is kept beside it like other imports.
- The result set is an ordinary imported set with no classes, regions or cells. Its upload row (`result_format` `heatmap`) marks it as a heatmap, so no migration is needed.
- A result upload left waiting on the uploader's choices for 7 days (`CHOICES_WAIT`) is swept by the stale upload job. The quarantine object is deleted, the row is marked expired and the sweep is audited. The check sets `last_activity_at`, so the clock starts at the check.

## Consequences

- One object per heatmap is cheap and matches the engine's grid. A very large heatmap is fetched whole, so a later task may tile it if real files grow past a few megabytes.
- The uploader can accept only the first guess. Picking another guess needs a choice field in `ImportChoices`.
- The viewer does not yet fetch `heatmap.json` or draw imported heatmaps. That wiring is a follow-up.
