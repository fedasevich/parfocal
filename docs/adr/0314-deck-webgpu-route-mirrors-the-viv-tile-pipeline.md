# 0314. The deck.gl WebGPU route mirrors the Viv tile pipeline and owns its tile textures

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-037 (deck.gl 9.4 WebGPU route). Touches VIEW-036 (renderer interface and route switching) and VIEW-038 (custom WebGPU engine route).

## Context

[ADR 0302](0302-renderer-routes-switch-inside-the-engine-behind-lazy-loaders.md) (renderer routes switch inside the engine behind lazy loaders) compares every route with the same golden images, and those images were drawn by Viv. The POC's deck.gl 9.4 route ([doc 23](https://github.com/fedasevich/pathlogy-poc/blob/master/docs/23-deck-webgpu-three-way.md)) read the slide's native levels through its own `Tileset2D` and let deck.gl build each tile texture from an `ImageData`. deck.gl's `createTexture` always generates mipmaps and samples them with a linear mipmap filter, while Viv uploads one level per tile. The route factory is synchronous, but a WebGPU device is created asynchronously, and the engine destroys the old route before it creates the new one.

## Options considered

1. Port the POC route: a native-level tileset and deck.gl-built textures. It needs no power-of-two ladder, but it picks other levels than Viv at the same zoom and samples through mipmaps, so it cannot match the Viv goldens within their tolerances.
2. Mirror the Viv pipeline: the same `createVivLevels` ladder, the same decode workers, deck.gl's stock `TileLayer` with Viv's `extent`, `minZoom` and `maxZoom`, and tile textures the route creates itself with one mip level and Viv's samplers. Pixel parity comes from sharing the data path, and the route must free its own textures.
3. Wrap Viv's `MultiscaleImageLayer` on a WebGPU device. Viv's shaders are GLSL only, so this cannot run.

## Decision

Option 2. `src/deck-webgpu/deck-webgpu-route.ts` feeds a `TileLayer` over `BitmapLayer` from `createVivLevels` and `createWorkerRegionReader`, expands each RGB tile to RGBA, and uploads it as an `rgba8unorm` texture with one mip level, linear filtering and nearest magnification on the finest level only ([ADR 0112](0112-finest-level-sampling-and-webgl-context-recovery.md), finest level sampling and WebGL context recovery). Textures are destroyed in `onTileUnload` and when the slide or the route goes away. Overlays go through the same `createOverlayLayerBuilder` as the Viv route ([ADR 0108](0108-overlay-layers-as-typed-data-over-deck-gl.md), overlay layers as typed data over deck.gl).

The POC's silent failures are handled this way:

- `minZoom` is the coarsest ladder level and an `extent` is set, so the fitted view draws instead of hiding.
- The device is requested with `featureLevel: "max"`, which asks for the adapter's own limits. A polygon layer whose vertex buffer (24 bytes per vertex) would still pass `maxBufferSize` is left out and reported as `WebGpuBufferLimitError`, so it cannot invalidate the whole frame.
- Every change redraws with a reason string, as the Viv route does.
- `watchWebGpuDevice` counts uncaptured errors, and the golden and switch tests assert the count is zero.

The async device is handled in two places. The lazy loader asks for an adapter and throws `WebGpuUnavailableError` before the engine touches the current route. `whenIdle` does not resolve before a first frame was drawn and the GPU queue reported its work done, and it rejects when the device could not be created or was lost. The route destroys its device itself, because `Deck.finalize()` does not.

The route draws 8-bit RGB slides only, as [ADR 0098](0098-viv-and-deck-gl-versions.md) (Viv and deck.gl versions) decided, and throws `UnsupportedDeckWebGpuSourceError` for anything else. It runs on the one deck.gl and luma.gl install, with `@luma.gl/webgpu` 9.4.2 added to the viewer engine.

## Consequences

Measured on this Mac under SwiftShader ([result](../results/2026-11-15-deck-webgpu-route-goldens-and-switch-memory.md)): the three CMU-1.svs goldens match on the route with zero uncaptured GPU errors, a switch from Viv to the route and back still matches the 10x golden, and 15 switches between the two routes grow the heap 3.5% with one deck and one canvas each round.

Overlays needed four more things, all inside the route so that the shared builder and Viv do not change:

- The route uploads every overlay `ImageData` (rasters and the pin atlas) into its own texture. On a software adapter luma.gl 9.4.2 uploads an `ImageData` through a 2D canvas, which zeroes the colour under transparent texels and put a dark fringe around the heatmap.
- The pin atlas keeps a mip chain, as deck.gl gives it on WebGL.
- deck.gl's `PathStyleExtension` has no WGSL, and a dashed layer invalidates the whole frame. At first the route removed the extension and drew the outline solid. Since VIEW-070 (dashed AI proposals on the deck.gl WebGPU route) it swaps the extension for `WgslDashExtension` (`src/deck-webgpu/wgsl-dash-extension.ts`), a subclass that keeps deck.gl's attributes and dash metrics and injects the same dash maths as WGSL at text anchors in `PathLayer`'s shader, the way deck.gl's own `TripsLayer` does. An extension it cannot translate is still left out and reported as `DeckWebGpuUnsupportedOverlayError` once.

- The shared builder closes a ring with two wrapped vertices. deck.gl's WebGPU `PathLayer` left a mark on every ring with that buffer, so the route copies the data of loop layers and adds a third wrapped vertex (`src/deck-webgpu/loop-data.ts`).

Rasters, pins, ID labels and polygon outlines then match Viv at the Viv tolerance. Solid AI proposals differed from their golden in 0.63% of pixels and were bounded at 2%. With the WGSL dash of VIEW-070 they differ in 0.085%, and `render/routes-cmu1.spec.ts` holds every overlay kind at the Viv tolerance of 0.1%. The rest is the first edge of each ring, which Viv draws twice at two dash phases and this route draws once. Only the variant the overlay builder uses (path mode, pixel units, butt caps, no antialiasing) was compiled and measured on a device.

`switchRenderer` in the engine now treats the first replay as part of starting a route. A route that throws while it is created or while it is handed the open slide is destroyed, and the previous route is created again. Before, only a throwing factory was covered, and this route throws for a slide that is not 8-bit RGB.

The pan and budget specs run on a named route with `PARFOCAL_RENDERER_ROUTE=deck-webgpu`, and pass their existing budgets on this route.

Tests that need WebGL and WebGPU in one browser set `WEBGPU_SWIFTSHADER_ARGS` at the top of their file, because Playwright does not allow launch options inside a `describe`. The alternate route goldens therefore live in `render/routes-cmu1.spec.ts`, and `render/viv-cmu1.spec.ts` keeps the primary route on the unchanged flags. This replaces the single loop that ADR 0302 describes.

The ADR 0098 question about Vite is answered: with one deck.gl and luma.gl install the route loads through a plain dynamic import in both harness servers, with no `optimizeDeps` exclusions.

Not done here: a route picker in `mountSlideViewport`, which ADR 0302 leaves to the first alternate route, and a run on a real GPU. Dashes on WebGPU were built in VIEW-070. Both were done in VIEW-071 (pick the renderer route per slide, checked on a real GPU). `mountSlideViewport` mounts Viv first and switches through `createRendererSwitcher`. The developer renderer setting picks the route on an open slide, and the slide stays on Viv when the route is refused or its device fails. Measured on the Mac's Apple M4 ([result](../results/2026-11-15-renderer-route-picker-on-a-real-gpu.md)), the route draws the same slide frames as Viv in the same browser. Translucent outlines differ on the first edge of each ring, because Viv and this route close a ring differently. The test that shows it is marked as an expected failure until VIEW-072 (closing dashed rings in the shared overlay builder) lands.
