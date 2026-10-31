# 0108. Overlay layers are typed data with one z-order table, drawn through deck.gl with precomputed polygon indices

- Date: 2026-10-25
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-026 (overlay layer system). Closes the polygon indices item of VIEW-030 (memory and teardown correctness). Touches VIEW-027 (outline casings), VIEW-028 (overlay level of detail), VIEW-029 (cull grid), VIEW-037 (deck.gl 9.4 WebGPU route), VIZ-001 (result sets in the Layers tab) and OBJ-002 (object ID labels).

## Context

The engine already had `registerOverlay({ id, order })`, `setOverlays` and `invalidateOverlay` on the route, but nothing described what an overlay is or drew one. VIEW-026 asks for typed layers for human annotations, AI proposals, nuclei results, heatmaps, coverage, comment pins and measurements, in a fixed z-order with per-layer visibility and opacity, proven by golden tests over a slide.

The POC drew proposals, pins and measurements on a 2D canvas above the slide and drew the nucleus layer through custom WebGPU or deck.gl `SolidPolygonLayer`, `PathLayer`, `ScatterplotLayer` and `BitmapLayer` ([doc 27](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/27-overlay-level-of-detail.md), [doc 31](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/31-culling-paging-and-decoder-stutter.md)). A 2D canvas cannot follow the camera as exactly as deck.gl does, and it is a second drawing system to keep in step. Outlines, dots, bitmaps and icons are the four things deck.gl draws today, and they cover every kind in the task.

The engine package must stay framework free, and its main entry must stay importable from Node without deck.gl ([ADR 0102](0102-viv-route-feeds-a-virtual-rgb-ladder.md)).

## Options considered

Where the layer descriptions live:

1. Hand the route deck.gl layers. Simple, but the engine would depend on deck.gl, a WebGPU route would have to translate them, and unit tests would need a GPU.
2. Plain typed data in `src/overlay`, a deck.gl builder in `src/overlay/deck` that only the Viv route imports. The data is testable in Node, and a second route can read the same descriptions.

Where the z-order lives:

1. Each caller passes its own `order`. Two screens can disagree, and a new layer type can land between two others by accident.
2. One table, `overlayStack` in `src/overlay/z-order.ts`, and constructors that take the order from the kind. Callers cannot pass one.

How visibility and opacity change:

1. Unregister and register again. Geometry would be rebuilt unless a cache sat in front, and the layer would vanish for a moment.
2. Add `update(layer)` to `OverlayRegistration`, and keep each layer's deck.gl `data` object by identity so that a state change never touches it. Hidden layers stay on the GPU with `visible: false`, and unregistering takes them out of the list so that deck.gl destroys their models and buffers.

How polygons are triangulated:

1. Let deck.gl run earcut inside `updateState` every time the data changes. Nothing to build, but it costs 261 ms per update at 1M polygons.
2. Run earcut once when the batch is built and pass the indices as `data.attributes.indices` with `_normalize: false`. It needs `@math.gl/polygon` as a direct dependency, which was already in the lockfile through deck.gl, and it supports single rings only.

How the goldens get their slide:

1. A synthetic slide. Fast and independent of fixtures, but it shows nothing of how colours read on tissue.
2. CMU-1.svs at the 10x tissue view, in a 400 × 300 viewer. It is the slide of the existing goldens and the `viewer` fixture group already carries it.

## Decision

Option 2 for the descriptions, the z-order, the state changes, the triangulation and the goldens.

- A layer is a `VectorOverlay` (kinds `human-annotations`, `ai-proposals`, `nuclei` and `measurements`, with polygons, open paths and points), a `RasterOverlay` (`heatmap` and `coverage`, an RGBA grid over a slide area) or a `PinOverlay` (`comment-pins`, open or resolved). All carry `visible` and `opacity`.
- The stack, from the bottom: coverage, heatmap, nuclei, AI proposals, human annotations, measurements, comment pins. Rasters sit under vectors, human work sits over AI proposals, and pins are never covered. Two layers of one kind keep registration order, so the later one is on top. Bare `{ id, order }` overlays that the engine already accepts are ignored by the Viv route.
- `createOverlayController(engine)` is the app-facing API: `set`, `setVisible`, `setOpacity`, `invalidate`, `remove` and `clear`. It registers a layer the first time and updates it afterwards.
- The deck.gl builder turns a polygon batch into fills (`SolidPolygonLayer`) and outlines (`PathLayer` as closed loops, which deck.gl needs with the first two vertices of each ring appended), paths into `PathLayer`, points into `ScatterplotLayer`, rasters into `BitmapLayer` and pins into two `IconLayer`s fed by an atlas that `createPinAtlas` draws in code, so no canvas, font or image file is involved. Widths and radii are in screen pixels, so they stay the same size at every zoom. Nothing is pickable.
- `invalidate` gives the layer new deck.gl ids and new data. Removing a layer deletes its cache entry and the layer leaves the deck.gl list.
- `whenIdle` also waits for every overlay layer to be loaded, because the bitmap and icon textures load asynchronously.
- Goldens are `viv-overlay-<kind>.png` for each kind plus `viv-overlay-stack.png`, compared with a stricter tolerance than the slide's JPEG row (4 levels, 0.1% of pixels, mean error 0.5), because a missing pin is under 0.5% of a frame. Each test also asserts the layer changed at least 0.3% of the pixels of the bare slide, so an overlay that never drew cannot pass on tolerance.

[The result](../results/2026-10-25-overlay-polygon-indices.md) has the numbers for the indices: a layer update of 1M polygons took 39 ms precomputed against 261 ms in deck.gl's own earcut, with identical pictures, and building the batch once took 273 ms.

## Consequences

- VIEW-026 (overlay layer system) is built in `packages/viewer-engine/src/overlay`, with unit tests for the table, the batches, the controller and the builder, and 8 goldens in `packages/golden-images/goldens`.
- The precomputed polygon indices that VIEW-030 (memory and teardown correctness) left open are built here. The open notes in [ADR 0103](0103-memory-settings-and-test-baseline.md) and in the [memory result](../results/2026-10-23-memory-teardown-swiftshader.md) can be closed when the parent merges.
- `OverlayRegistration` gains `update`. The engine edit is the `update` method and its type.
- `@math.gl/polygon` 4.1.0 is a direct dependency of `@parfocal/viewer-engine`. The lockfile changes by one entry.
- Polygons with holes are not supported yet. A batch is one ring per polygon. TODO: add hole starts to `PolygonBatch` when annotations need them, which changes the triangulation call and the outline loops.
- VIEW-027 (outline casings) draws a second outline layer under the colour layer inside `vectorLayers`, and the dashed proposal style comes with it. VIEW-028 (overlay level of detail) and VIEW-029 (cull grid) change what `createOverlayLayerBuilder` hands deck.gl for a nucleus layer. The builder takes the layer descriptions and could take the camera as a second argument. The descriptions need no change.
- VIEW-037 (deck.gl 9.4 WebGPU route) can use the same builder, since it only constructs deck.gl layers.
- A 1M polygon batch takes 273 ms to triangulate on the main thread. Large result sets should triangulate in a worker or ahead of time. TODO: decide where when the nucleus result loading task is planned.
- Hidden layers keep their GPU buffers, so hiding a 1.6M nucleus layer does not free memory. Removing it does. TODO: ask whether the Layers tab needs a third state that frees the buffers.
- Opacity is applied to each deck.gl layer of an overlay on its own, so a half-opaque annotation shows its fill through its outline, and fills multiply the layer opacity with the style's fill opacity.
- Overlay goldens are also slide goldens, so a deliberate change to how CMU-1.svs draws, such as the native JPEG decoder of VIEW-005 (native JPEG decode), must regenerate them together with the slide goldens.
- The 8 goldens add about 2.5 MB of PNG to the repository, because they show real tissue.
