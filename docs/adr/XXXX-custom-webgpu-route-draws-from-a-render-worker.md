# XXXX. The custom WebGPU route draws from a render worker and keeps the Viv tile data path

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-038 (custom WebGPU engine route). Touches VIEW-036 (renderer interface and route switching) and VIEW-037 (deck.gl 9.4 WebGPU route).

## Context

[ADR 0302](0302-renderer-routes-switch-inside-the-engine-behind-lazy-loaders.md) (renderer routes switch inside the engine behind lazy loaders) reserves the route id `custom-webgpu` and compares every route with the goldens that Viv drew. The POC's custom engine ([`src/webgpu`](https://github.com/fedasevich/pathlogy-poc/tree/master/src/webgpu)) drew from a render worker on an `OffscreenCanvas`, kept tiles in one atlas texture, culled nuclei in a compute pass and drew annotations as instances, so that changing an annotation set cost one buffer write. It read the slide's native levels with its own tile workers and stored each channel as a plane. [ADR 0314](0314-deck-webgpu-route-mirrors-the-viv-tile-pipeline.md) (the deck.gl WebGPU route mirrors the Viv tile pipeline) already found that a route which picks other levels than Viv cannot match the goldens.

## Options considered

1. Port the POC engine whole: native levels, plane atlas, own tile workers. It keeps every POC idea, but it picks other levels than Viv and samples differently, so it cannot pass the goldens.
2. A WebGPU renderer on the main thread that shares the Viv data path. It is the smallest change, but every frame competes with input and React for the main thread, which the POC measured as the weak point of the deck.gl routes.
3. A render worker that owns the device and the canvas, fed by messages. The main thread keeps what already exists and is shared: the `createVivLevels` ladder, the decode workers, tile selection and the overlay descriptions.

## Decision

Option 3. `src/custom-webgpu/` holds the route and `src/workers/render.worker.ts` is the worker entry. The route creates a canvas, transfers it with `transferControlToOffscreen` and never creates a `Deck`.

Slide pixels:

- The level is `-ceil(zoom)` clamped to the ladder, the rule deck.gl's `TileLayer` uses for a flat view (`tileLevelFor`). Tiles come from the same `createVivLevels` and `createWorkerRegionReader` as the other routes, at most 10 requests at a time, nearest to the centre first.
- The atlas is one `rgba8unorm` 2D array texture with one layer per tile. A layer has the same texel grid as the single texture Viv gives a tile, and the shader clamps the lookup half a texel inside the valid part, which equals clamp to edge. Its size follows the viewport: twice the largest count of visible tiles plus 16 layers, at least 32, at most the adapter's layer limit capped at 1024. Layers are reused least recently drawn first.
- Nearest magnification on the finest level ([ADR 0112](0112-finest-level-sampling-and-webgl-context-recovery.md), finest level sampling and WebGL context recovery) is chosen on the CPU, because a lookup at an explicit level always uses the magnification filter. The rule is that a texel covers one device pixel or more (`magnifiesFinestLevel`), which is when a GPU picks the magnification filter. Every golden runs at a pixel ratio of 1, so the ratio part is covered by a unit test only.
- A tile that is not loaded yet is covered by its nearest loaded ancestor. Coarser tiles are never drawn under loaded ones, since they reach a few pixels past the slide edge.
- Brightness is one uniform. New tiles fade in over the Viv fade time.

Overlays, read straight from the overlay descriptions without deck.gl:

- Each vector set has one vertex buffer of instances with instance step attributes: fill triangles, then line segments, then points. A changed set is one `writeBuffer`, and a change of opacity, visibility, colour, width or dash only changes a uniform. `createOverlayBuffers` holds this and a unit test counts the writes.
- A segment is drawn in two parts from the same instances: the body as a rectangle and a round cap at its start. Dashes use deck.gl's coverage integral, and a dashed ring starts at the middle of its first edge as the Viv route does. Points port deck.gl's scatterplot edge maths. Layer opacity is raised to 1 / 2.2 as deck.gl does.
- Heatmap and coverage rasters get one texture each. Comment pins use the shared pin atlas with a mip chain built on the CPU.

The lazy loader asks for an adapter on the main thread and throws `WebGpuUnavailableError` before the engine touches the current route. `whenIdle` resolves after the worker has acknowledged the last frame with `onSubmittedWorkDone` and three calm main thread frames, and rejects when the device could not be created or was lost. Frames are sent only when something changed. The route throws `UnsupportedCustomWebGpuSourceError` for a slide that is not 8-bit RGB.

## Consequences

Measured on this Mac under SwiftShader ([result](../results/2026-11-15-custom-webgpu-route-goldens-switch-memory-and-budgets.md)): the three CMU-1.svs goldens and seven of eight overlay kinds match at the Viv tolerance with zero uncaptured GPU errors, 15 switches across the three routes keep one canvas and no `Deck` on this route, and the pan and budget specs pass their existing budgets with `PARFOCAL_RENDERER_ROUTE=custom-webgpu`.

Not built, and each one is reported or stated instead of drawn wrong in silence:

- ID labels. Matching deck.gl's text needs its font atlas and paragraph layout. The route leaves the layer out and reports `CustomWebGpuUnsupportedOverlayError` once, and `render/routes-cmu1.spec.ts` skips that kind on this route with a reason. A route picker would offer a route without ID labels until this is built. TODO: backlog task.
- The level of detail tiers of the shared overlay builder (density raster and dots for many nuclei). This route draws full outlines at every zoom. TODO: backlog task.
- Compute culling. Off-screen instances are clipped by the GPU. The POC used a compute pass for nuclei stored as ellipses, which the overlay descriptions do not carry. TODO: measure on a real GPU with a large set before building it.
- Translucent outlines blend twice where a round cap overlaps a neighbouring segment. The goldens use opaque outlines.
- A guard for a set larger than the device's `maxBufferSize`. The deck.gl WebGPU route leaves such a layer out and reports it, and this route would raise a GPU error.
- Recovery after a lost device. The route fails and `whenIdle` rejects, and the user has to switch routes.
- A run on a real GPU.

`browser/route-switch.spec.ts` now measures heap growth for each route, from its first sample after the warm-up to its last, and asserts the largest. With three routes the old pair was a custom WebGPU sample against a Viv sample, which measured the difference between routes (23.5%) instead of growth.

The harness pages (`harness/viv/main.ts`, `harness/viv/overlays.ts`, `browser/page/route-switch-harness.ts`, `browser/page/pan-harness.ts`) pass options to the third route and read its decode statistics and GPU error count.
