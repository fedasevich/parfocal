# XXXX. Review objects carry their outline in slide pixels, and the engine's bounds limit the still's camera

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas (standing approval), written up by Claude
- Backlog: VIZ-013 (engine behind the still for any slide). Builds on [ADR 0282](0282-guided-review-and-the-full-viewer-draw-the-slide-through-the-engine-behind-the-still.md) (guided review and the full viewer draw the slide through the engine behind the still).

## Context

Guided review and the full viewer drew object outlines from the mock region table, which only fits the fixture slide. On any other slide the engine drew no outlines, or drew them in the wrong place. The still also let the reviewer zoom out and drag past the slide edge further than the engine allows, so after a wheel-out or a long drag the engine pixels and the still's SVG drifted apart.

## Options considered

1. Add an optional `outline` to each review object: a flat list of x and y pairs in level 0 slide pixels, the same shape as the `points` of the outline typing draft.
2. Send GeoJSON polygons, as annotations do. Review objects are one ring each, and the engine draws flat rings, so GeoJSON would be parsed and flattened on every load.
3. Read the outlines from the result set's packed object files in the browser. That needs the cell chunk reader for regions too and is a bigger change than this task.

## Decision

Option 1. `listReviewObjects` objects may carry `outline`, and its slide summary carries the slide's `width` and `height` in level 0 pixels. When the objects carry outlines, the engine draws that ring as it is, and the still converts it into its own units through the inverse of the overview frame, which it builds from the slide size without waiting for the engine, so the current region's tinted outline, the region's home camera, the tags and the minimap use the real geometry. Objects without an outline keep the mock region table, so the fixture slide looks as before.

`StillEngine` hands the still a link with a clamp once the slide has settled, and takes the link back if the engine fails, so the still shows its own image again. The clamp maps the still camera into the engine, applies the engine's zoom-out limit and slide edge and maps the result back, and the still applies it to the camera it shows, to every wheel step and to every drag, and writes a clamped camera back when another control asked for one past the limit. The two layers therefore never disagree.

Both screens decide whether the engine runs through one predicate, `engineBehindStill`: not in the cell view, not when tiles failed or are still loading, not when a task asks about the slide and finds no objects, and not when the screen draws its own layers.

## Consequences

- A slide with real outlines draws them on the still even when the engine is off. If the slide size is missing, the still waits for the engine's frame instead.
- The engine's zoom-in limit is not applied to the still, because the full viewer must still reach its 16× readout. Past 16 screen pixels per slide pixel the engine stops zooming while the still goes on, as ADR 0282 already noted.
- Tile failures behind the still are read from the route each time it settles and shown as a short notice over the slide, which clears once the tiles load.
- The real API has no review objects route yet. When it does, it should send `outline` and the slide size in the same shape.
