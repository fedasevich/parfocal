# XXXX. A painted map is saved as whole versions of one binary tile file

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: AITUM-005 (painted maps). Builds on AITUM-004 (view-scoped map on demand) and [ADR 0329](0329-view-scoped-tumor-map-in-slide-anchored-tiles.md).

## Context

People paint a map with the brush, such as a tumor bed, and want it kept, versioned and exportable. The view map of ADR 0329 already holds sparse slide-anchored tiles of one byte per cell, so a painted map can be the same structure. What remains is how to store a version and what file to export.

## Options

1. Store each painted tile as its own row and version tiles one by one. Saves are small, but a version is a set of rows to reassemble and every reader must agree on which tiles belong to which version.
2. Store vector brush strokes, as annotations do, and rasterise them on read. Edits stay exact, but every reader needs the rasteriser and the result depends on its version.
3. Store each version as one binary file of the painted tiles, the same bytes the export hands out.

## Decision

Option 3. `packages/viewer-engine/src/overlay/painted-map.ts` paints brush strokes into the view map tiles and encodes the map as a `.pfmap` file: the magic `PFPM`, format 1, the tile size, the cell size, the slide width and height, the tile count, then for each tile with a painted cell its column, row and one byte per cell, in row then column order. Unpainted tiles are left out, so the encoding is canonical and an empty map is the 24 byte header.

`painted_maps` holds one row per map with its name, current version, cell and tile size and painted cell count. `painted_map_versions` keeps every saved file. Saving sends the version it started from and gets `painted-map-changed` when someone saved in between. A save cannot change the cell or tile size, because a map at another cell size is a new map (ADR 0329). The API reads every file before it stores it and refuses one painted on a slide of another size. `GET .../versions/{version}/file` exports the stored bytes unchanged, which `createPaintedMap` takes back.

## Consequences

- An export is the stored version byte for byte, and a re-import round-trips it.
- At the default 256 pixel cell a fully painted 100,000 pixel square slide is about 150 KB per version, so whole versions are cheap. Retention purge does not cover painted maps yet.
- The brush in the viewer does not yet paint into a painted map or save one. That is a follow-up on the review workspace.
