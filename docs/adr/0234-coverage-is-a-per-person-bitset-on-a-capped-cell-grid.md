# 0234. Coverage is a per person bitset on a capped cell grid

- Date: 2026-11-04
- Status: Proposed
- Deciders: Claude, for the owner to confirm
- Backlog: VIEW-025 (coverage tracking)

## Context

VIEW-025 records which tissue each person has seen at 10x or more, per slide, and keeps it on the server. The viewed ring (CASE-009) and the coverage checks after it read the same raster. The stored shape is costly to change once rows exist and other screens read it.

## Options considered

1. **A bitset over a fixed cell grid.** One bit per cell, sent as the indices of newly seen cells and joined on the server.
2. **A list of seen view rectangles.** Exact, but it grows with every pan and needs a union pass before any percentage.
3. **A tile list per pyramid level.** Ties coverage to the reader's tiling, which differs between formats.

## Decision

Option 1. The grid starts at 64 slide pixels per cell, the tissue mask's cell, and doubles until the longest side has at most 1024 cells, so a row holds at most 128 KB. The server derives the grid from the slide's size and refuses a batch on another grid. A cell counts as seen when its centre lies inside a view at 10x or more. `slide_coverage` keeps one row per slide and person, with the bits in `seen` and their count in `seen_cells`. The client sends a batch at most every 4 seconds, up to 4096 cells, and again when the page is hidden.

The percentage is of tissue cells when a tissue mask is on the client, and of the whole slide until then.

## Consequences

- `GET` and `POST /api/slides/{slide_id}/coverage` read and add to the caller's own raster. Coverage only ever grows.
- `@parfocal/viewer-engine` exports the grid, raster, share and a batching tracker, so later screens read one API.
- A slide whose size changes gets a new grid and starts empty.
- CASE-016 (systematic scan on the real tissue mask) serves the stored `tissue.png` as `GET /api/slides/{slide_id}/tissue`, a bitset on this same grid, so the live viewer counts tissue cells and the systematic scan steps over them. A slide without a stored mask still counts against the whole slide.
