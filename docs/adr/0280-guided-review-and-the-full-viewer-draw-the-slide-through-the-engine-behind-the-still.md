# 0280. Guided review and the full viewer draw the slide through the engine behind the still, and the still stays as the fallback

- Date: 2026-11-09
- Status: Accepted
- Deciders: Yurii Fedas (standing approval), written up by Claude
- Backlog: VIZ-012 (guided review and the full viewer on the live slide). Builds on [ADR 0268](0268-how-display-state-reaches-the-overlay-system.md) (how display state reaches the overlay system) and [ADR 0108](0108-overlay-layers-as-typed-data-over-deck-gl.md) (overlay layers as typed data over deck.gl).

## Context

Only the live slide route mounted the Viv slide stage. Guided review and the full viewer drew the mock's `SlideStill` as SVG, so a reviewer there never saw real pixels. Both screens keep their own camera, keys, Display settings, first-read blinding and connection banner, and many specs assert on them. The live stage is a whole annotation workspace (tools, saving, areas), which these two screens must not grow.

## Options considered

1. Replace `SlideStill` with `SlideStage` in the two screens. The camera, keys and banners would have to be rebuilt around the stage, and the annotation workspace would come along.
2. Keep `SlideStill` as the owner of the camera and pointer input, and put the engine canvas behind its transparent SVG. The still's camera drives the engine camera one way, and the engine draws the object outlines.
3. Convert the mock regions to real slide objects on the server. That needs real geometry the fake data does not have.

## Decision

Option 2. `SlideStill` takes a `backdrop` render prop and an `engineDrawn` set. `StillEngine` (in `apps/web/src/viewer`) opens the slide through the same tile access and signed open request as the live stage, follows the still's camera through `engineCameraOf`, and draws the objects through `createObjectDrawing` with the resolved Display settings. When the engine is up the still hides its `<image>` and the region paths the engine draws, and keeps the current region's tinted outline, the tags, the redraw layer and every overlay of the screen.

The mock overview image is placed inside the fixture slide by `overviewFrame`, which fits the overview into the slide and centres it. The mock regions are parsed from their SVG paths into rings in the same frame.

The still stays where it was in these cases.

- WebGL is missing, which `webglAvailable` checks once.
- The engine fails to open the slide.
- The cell view, the tiles-loading and tiles-failed scenes, and scenes with no results.
- First-read blinding: before the first read the screen passes no objects, so the engine draws pixels only and the still draws its white region outlines.
- Full viewer scenes that draw their own layers (heatmap, density, confidence map, comparisons, swipe, side by side): they keep their SVG layers over the engine pixels.

## Consequences

- The first-read step, Annotate tasks, the cell view, the focus view and the adjudicator view still draw the SVG still and need their own follow-up.
- Camera zoom beyond the engine's limit would clamp, so the mapping is only faithful up to 16 screen pixels per slide pixel. The region view tops out well below that.
- `viewer-engine` stays a dynamic import, so it stays out of the first page bundle.
