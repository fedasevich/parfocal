# 0302. Renderer routes switch inside the engine behind lazy loaders

- Date: 2026-11-14
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-036 (renderer interface and route switching), VIEW-037 (deck.gl 9.4 WebGPU route), VIEW-038 (custom WebGPU engine route)

## Context

Viv is the primary renderer, and two alternates are planned behind the same interface. A user or a test must be able to change the route on an open slide without losing the camera, the overlays or the brightness, and without leaving a second canvas or a second GPU context behind. The alternates are large modules that most sessions never need, so they must not load with the viewer. [ADR 0100](0100-viewer-hot-path-state-outside-react.md) (viewer hot-path state outside React) already keeps the camera and overlays in the engine, and [ADR 0102](0102-viv-route-feeds-a-virtual-rgb-ladder.md) (Viv route feeds a virtual RGB ladder) left `whenIdle` on the Viv route only.

## Options considered

1. Dispose the whole engine and build a new one with another factory. It needs no engine change, but every subscriber, input binding and overlay is lost and the caller must replay them.
2. Make `RendererFactory` asynchronous. Lazy loading becomes simple, but `mount` turns asynchronous for every caller and a half-loaded route can exist.
3. Keep the factory synchronous, add `switchRenderer` to the engine, and load factories in a separate registry. The engine stays simple and the loading race lives in one small place.

## Decision

Option 3. `RendererRoute` gains `whenIdle(signal)`, the only method hoisted from the Viv route. `createViewerEngine` returns a `RoutedViewerEngine` whose `switchRenderer(factory)` destroys the old route first, creates the new one in the same container and replays overlays, brightness, slide and camera. If the new factory throws, the engine restores the previous factory and route. `createRendererSwitcher` holds one loader per route id (`viv`, `deck-webgpu`, `custom-webgpu`), loads a factory on demand and uses a generation token so that a slower earlier load never replaces a later choice. A route id without a loader raises `RendererRouteUnavailableError`. `pixelRendererRoutes` in `src/viv` is the one place where routes for pixel slides are registered, and today it registers only Viv.

Golden files keep route-free names, so every route is compared with the same image. The golden spec loops over all three route ids and skips an id that has no loader, which is reported as skipped and never as passed.

Measured on this Mac under SwiftShader with only Viv registered: 15 switches on `CMU-1-Small-Region.svs`, heap growth 5.3% after a five-switch warm-up against a 10% budget ([ADR 0103](0103-memory-settings-and-test-baseline.md), memory settings and test baseline), one live `Deck` and one canvas after every switch, zero of each after dispose, 633 to 670 ms per switch. An earlier 60-switch soak with a one-switch warm-up grew 7.9% and stayed flat at 7.8 MB from about the eighth switch. Every switch was Viv to Viv. The numbers are in the [result file](../results/2026-11-14-renderer-route-switch-memory.md).

## Consequences

VIEW-037 (deck.gl 9.4 WebGPU route) and VIEW-038 (custom WebGPU engine route) each add one loader to `pixelRendererRoutes` with a dynamic import. The golden tests and the switch memory test then cover the new route without a test change. Until then the goldens pass on one of three routes, so the "all three routes" part of VIEW-036 closes only when both alternates land. No route picker exists in the app yet. The first alternate route adds it to `mountSlideViewport`. Destroying the old route first means one blank frame during a switch, which is accepted because two live GPU contexts cost more.
