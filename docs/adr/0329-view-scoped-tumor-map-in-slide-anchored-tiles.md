# 0329. A view-scoped tumor map is a sparse map of slide-anchored tiles scored on demand

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: AITUM-004 (view-scoped map on demand). Builds on AITUM-002 (heatmap layer) and leaves room for AITUM-005 (painted maps).

## Context

When a slide has no whole-slide tumor map, the reviewer should still get a map of what they are looking at. They pan and ask again, and the map should grow without rescoring what is already scored. AITUM-001 (the tumor map job) has not landed, so there is no server model to call yet.

## Options

1. Score the exact view rectangle each time and keep a list of rectangles. Overlaps are scored twice and merging ragged rectangles into one grid is fiddly.
2. Split the slide into a fixed grid of cells grouped into tiles anchored at the slide origin, score only the tiles under the view that are missing, and keep them in a sparse map.
3. Start the whole-slide job when the user asks. It costs a full GPU run for one look and takes minutes.

## Decision

Option 2. `packages/viewer-engine/src/overlay/view-map.ts` holds the model: a layout of 256 slide pixel cells grouped 16 by 16 into tiles, a sparse map of scored tiles keyed by column and row, one byte per cell on the same 0 to 255 scale as stored heatmap grids, and a flattening to a `HeatmapGrid` whose unscored cells are NaN so the heatmap colourizer leaves them clear. An ask scores only the missing tiles under the view through a `ViewMapScorer` seam and refuses a view that needs more than 64 new tiles, asking the user to zoom in. `withViewMapTile` writes any tile, so a painted map can reuse the same tiles.

The review workspace shows a "Map this view" panel only when the slide has no heatmap result set and a scorer exists. Today the scorer exists only in the fake API, where it draws three smooth spots. The real scorer arrives with the AITUM-001 server route.

## Consequences

- Panning and asking again extends the map and never rescores a tile.
- Tiles line up with each other and with future painted maps, so storing and exporting them later is a per-tile job.
- In production the panel stays hidden until a tumor scorer route exists.
- The cell size is fixed per map. A map at another cell size is a new map, not a resample.
