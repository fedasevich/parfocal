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

Option 1. `listReviewObjects` objects may carry `outline`. When they do, the engine draws that ring as it is, and the still converts it into its own units through the inverse of the overview frame, so the current region's tinted outline, the region's home camera, the tags and the minimap use the real geometry. Objects without an outline keep the mock region table, so the fixture slide looks as before.

`StillEngine` hands the still a link with the frame and a clamp. The clamp maps the still camera into the engine, applies the engine's zoom-out limit and slide edge and maps the result back, and the still applies it to the camera it shows, to every wheel step and to every drag. The two layers therefore never disagree.

Both screens decide whether the engine runs through one predicate, `engineBehindStill`: not in the cell view, not when tiles failed or are still loading, not when there are no results, and not when the screen draws its own layers.

## Consequences

- A slide with real outlines draws them on the still only once the engine has opened the slide, because the frame depends on the slide size. Without WebGL such a slide shows the still image with no outlines.
- The engine's zoom-in limit is not applied to the still, because the full viewer must still reach its 16× readout. Past 16 screen pixels per slide pixel the engine stops zooming while the still goes on, as ADR 0282 already noted.
- Tile failures behind the still are counted and shown as a short notice over the slide.
- The real API has no review objects route yet. When it does, it should send `outline` in the same shape.
