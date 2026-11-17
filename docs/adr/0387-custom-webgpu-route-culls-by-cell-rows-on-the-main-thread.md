# 0387. The custom WebGPU route culls by cell rows on the main thread and reuses the Viv level of detail tiers

- Date: 2026-11-17
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-073 (finish the custom WebGPU route). Follows [ADR 0327](0327-custom-webgpu-labels-once-per-ring-outlines-and-device-recovery.md) (glyph atlas, rings blended once and device recovery on the custom WebGPU route).

## Context

The [2026-11-15 timing](../results/2026-11-15-custom-webgpu-route-labels-translucent-outlines-and-device-loss.md) put the custom WebGPU route at 114.82 ms of GPU time for 1.6M nuclei at detail zoom and 21.12 ms of overlay time for 81k nuclei at overview, against the budgets of VIEW-029 (cull grid for overlays) of 6 ms a frame and 1 ms of overlay time. The route drew every segment of every nucleus at every zoom. The backlog line names compute culling and the level of detail tiers.

## Options considered

Culling:

1. A compute pass each frame that tests chunks of instances against the view, compacts the visible ones in their original order with a prefix sum and draws them with `drawIndirect`. It needs storage buffer usage and a binding limit above the default 128 MB for a 1.6M nuclei set, three dispatches per set, and its time falls outside the render pass timestamps the timing harness reads.
2. Order the small shapes of a set by the cell of the VIEW-029 cull grid once, when the set is sent, keep the instance offset of every shape, and send the instance ranges of the visible cell rows with each frame. The renderer draws each range with `firstInstance`. Nothing is written to a buffer when the camera pans.
3. Rebuild a subset of the instances on the main thread whenever the cull window changes, as the deck.gl routes do with `polygonSubset`.

Level of detail tiers:

1. Tiers of the route's own.
2. The tiers, thresholds and density raster of `lod.ts`, which the Viv route uses.

## Decision

Culling takes option 2, and the route has no compute pass. `cullShapes` in `culled-sets.ts` engages for the same sets as the Viv route (500 small shapes or more), orders the small shapes by cell with `buildCullGrid`, keeps the large shapes, paths and points after them, and `shapeInstanceStarts` gives the triangle, segment and repeated edge offset of each shape. Each frame `culledDraw` picks the window with `cullWindow`, which keeps its two padding cells and its hysteresis, turns `rowRanges` into instance ranges and appends the ranges of the large shapes and paths, which are always drawn. A translucent set draws its segment ranges and then its repeated edge ranges in the same depth pass, so a ring is still blended once.

The tiers take option 2. At the density tier the route draws the density raster of `densityRaster` through its raster pipeline with linear filtering. At the dots tier it draws the cell ordered centres of the small shapes as points of `lodDotRadiusPx`, culled by the same cell rows. The large shapes keep their outlines at every tier. The density raster and the dot set are sent beside the set, dropped with it and sent again after a lost device.

## Consequences

Measured on the Mac's GPU ([result](../results/2026-11-17-custom-webgpu-route-culling-and-detail-tiers.md)): 2.05 ms a frame for 1.6M nuclei at detail zoom against 6 ms, and 0.02 ms of overlay time for 81k nuclei at overview against 1 ms. All twelve custom WebGPU goldens and the lost device test keep their numbers, because the golden sets have fewer than 500 shapes and are drawn as before.

Within a culled set the small shapes are drawn in cell order, where the Viv route draws the window in original order. Two overlapping nuclei of different colours in one set can therefore swap which is on top. No golden covers this, since no golden set engages the tiers.

Ordering a set, the cull grid and the density raster are built on the main thread when a set is sent, as on the Viv route, and are kept per shape batch so a lost device does not build them again. An invalidated overlay builds them again, since its data may have changed in place. Their time for 1.6M nuclei was not measured.

The route still holds every instance of a set in one GPU buffer, so the buffer size guard of ADR 0327 (glyph atlas, rings blended once and device recovery) still applies to the full set. A compute pass stays possible if a set's visible rows become too many draws, which would show as CPU time in the render worker rather than GPU time.
