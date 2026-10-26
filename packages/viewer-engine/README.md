# @parfocal/viewer-engine

The framework-free viewer engine: camera, input, renderer routes, slide readers and decode workers ([ADR 0100](../../docs/adr/0100-viewer-hot-path-state-outside-react.md)).

## Commands

| Command | What it does |
|---|---|
| `pnpm --filter @parfocal/viewer-engine test` | Unit tests on `node --test`, with an injected clock and frame scheduler |
| `pnpm --filter @parfocal/viewer-engine test:browser` | Playwright suites in `browser/`: memory and teardown, pan fetches, deck settings, input, touch navigation, the interaction pause, overlay polygon indices, idle and hidden tab behaviour, JPEG 2000 downloads and damaged tiles, and OME channel contrast |
| `pnpm --filter @parfocal/viewer-engine traces:record` | Opens the input trace recorder in the default browser |

## JPEG 2000 and channel stacks

Aperio JPEG 2000 tiles (compression 33003 and 33005) decode through OpenJPEG WebAssembly in `src/pixel-source/tiff/jpeg2000`. geotiff imports the decoder on the first tile, the decoder imports the codec on its first decode, and both stay out of every other slide. The decoder throws `MainThreadCodecError` on a page and turns a damaged tile into a flat grey of 160 ([ADR 0111](../../docs/adr/0111-jpeg-2000-in-the-decode-workers-and-ome-channel-pages.md)). An OME-TIFF with one page per channel is read as a `channels` source by `src/pixel-source/tiff/ome-channels.ts`. `createVivChannelLevels` and `vivChannelLayerProps` in `src/viv/viv-channel-levels.ts` turn such a source into Viv levels and layer props with per-channel contrast limits. They are not wired into `createVivRoute`, which draws RGB only.

## Idle and hidden tabs

The engine asks for an animation frame only while a camera motion runs or a change waits to be delivered. Its requests go through `createGuardedFrames` in `src/engine/guarded-frames.ts`, which races each animation frame against a 500 ms watchdog, runs frames as `MessageChannel` tasks while the tab is hidden, and restarts every pending request under a new generation when the tab's visibility changes. Motion that is running when the tab hides lands on its target, and motion started while hidden does not animate ([ADR 0109](../../docs/adr/0109-idle-means-zero-frames-and-hidden-tabs-keep-loading.md)).

The Viv route gives deck.gl's animation loop a frame provider (`src/viv/deck-sleep.ts`) that parks the loop after 3 frames with nothing left to do. Any code that changes what the route draws must go through the route's `changed()`, which wakes the loop. `createVivRoute({ sleepWhenIdle: false })` keeps the old always-running loop for comparison. `yieldToMain` and `createTimeSlice` in `src/engine/scheduling.ts` slice long main-thread work with `scheduler.yield` or a `MessageChannel`.

## Finest level sampling and GPU loss

The Viv route draws the finest level with nearest sampling when a texel is larger than a screen pixel and every coarser level linearly ([ADR 0112](../../docs/adr/0112-finest-level-sampling-and-webgl-context-recovery.md)). `installTileInterpolation` in `src/viv/interpolation.ts` patches Viv's `BitmapLayer` once, and `createVivRoute({ interpolation: "linear" })` switches the rule off, which is the negative control of the tests in `packages/golden-images`.

`createGpuGuard` in `src/viv/gpu-recovery.ts` cancels `webglcontextlost` and waits for `webglcontextrestored`. The route then replaces its canvas and Deck from its own state, so `route.canvas` and `route.deck` are getters that must be read when used and never cached. `createVivRoute({ restoreTimeoutMs })` sets how long a restore may take while the tab is visible (5000 ms by default). When no restore comes, or more than 3 losses happen within 30 s, the route reports one `GpuUnrecoverableError` through `onError`, whose `userMessage` a UI can show, and releases the GPU. `route.gpu` exposes the status, the loss and recovery counts and the failure. `src/viv/webgpu-errors.ts` holds `watchWebGpuDevice` and `withErrorScopes` for the future WebGPU route, which no route calls yet.

## Input

`bindViewerInput(element, engine, options)` in `src/input/dom-input.ts` maps pointer, wheel and double-click events onto the engine's camera calls ([ADR 0107](../../docs/adr/0107-viewer-input-binding.md)). The rules live in the pure interpreter in `src/input/gestures.ts` and the wheel maths in `src/input/wheel.ts`, so they run in unit tests without a DOM. The options are the wheel mode and three hooks for the active tool: `primaryDragPans`, `panModifierHeld` (Space until the key registry exists) and `hitsEditableShape`.

Touch is read from the same pointer events. One finger drags with the camera profile's coast, two fingers pinch and pan about their midpoint, and lifting one finger of a pinch carries on as a drag from the finger that stays. A double tap zooms to 40x about the tap through `zoomToMagnification`, and a two-finger double tap flies to the tissue-aware whole-slide fit through `flyToFit`. The tap slop, the tap length, the double-tap window and distance and the 40x target live in `touchTuning` in `src/input/touch.ts`, and the interpreter takes a replacement through the `touchTuning` hook. Chrome also fires a `dblclick` after a touch double tap, so the binding ignores a `dblclick` within `syntheticDoubleClickGuardMs` of a touch ([ADR 0113](../../docs/adr/0113-interaction-signal-units-and-touch-gestures.md)).

## Interaction signal

`engine.interaction` is an `InteractionSignal` from `src/engine/interaction-signal.ts`. Every camera change and every held pointer gesture feeds it, so `moving()` is true while the camera moves or a finger is down and for 200 ms after. Background work such as a region pass calls `await engine.interaction.whenRested(abort)` before each slice, or subscribes with `subscribe`. The signal keeps no timer while nobody listens, so an idle engine still holds zero timers. Pass `interaction` in the engine options to share one signal. `browser/interaction.spec.ts` measures a pan with and without the pause against a stand-in busy job, because no inference engine exists in the browser yet ([result](../../docs/results/2026-10-26-interaction-pause.md)).

## Units

`src/camera/units.ts` converts between level-0 pixels (the canonical space), microns and the screen. Every function takes the microns per pixel as an argument and returns `null` when the slide has none, so an unknown spacing never gets a made-up scan objective, a digital label or a scale bar. `scanObjective` picks the nearest objective preset when it is within a factor of 1.25 of the native magnification and prefers a declared objective. `isDigital` is true only above the scan objective. `scaleBar` returns the longest round length that fits a width.

## Overlays

Overlay layers are plain typed data in `src/overlay` ([ADR 0108](../../docs/adr/0108-overlay-layers-as-typed-data-over-deck-gl.md)). `overlayStack` in `src/overlay/z-order.ts` is the one z-order table, from `coverage` at the bottom to `comment-pins` on top, and the constructors (`createVectorOverlay`, `createRasterOverlay`, `createPinOverlay`) take each layer's `order` from its kind. Geometry is built once into batches (`polygonBatchFromRings`, `pathBatchFromLines`, `pointBatchFromPoints`, or the flat `createPolygonBatch`), and a polygon batch carries its triangle indices. `createOverlayController(engine)` sets, shows, hides, fades, invalidates and removes layers. The Viv route turns the descriptions into deck.gl layers through `createOverlayLayerBuilder` in `src/overlay/deck`, which is exported from `@parfocal/viewer-engine/viv` so that the main entry stays free of deck.gl.

The overlay goldens are in `packages/golden-images` (`render/viv-overlays.spec.ts`, with `harness/viv/overlays.ts` as the page and `harness/viv/overlay-fixtures.ts` as the synthetic layers). Regenerate only them with `GOLDEN_UPDATE=1 pnpm --filter @parfocal/golden-images exec playwright test render/viv-overlays.spec.ts`. `browser/overlay-indices.spec.ts` compares precomputed triangle indices with deck.gl's own triangulation and prints the timings of the [result](../../docs/results/2026-10-25-overlay-polygon-indices.md).

## Recording input traces

The replay tests in `test/input/trace-replay.test.ts` run every JSON file in `test/input/traces/`. The files there now are synthetic and are named `*.synthetic.json`. Real recordings replace or join them.

1. Run `pnpm --filter @parfocal/viewer-engine traces:record`. Vite serves `browser/page/trace-recorder.html` and opens it.
2. Pick the device, Mouse or Trackpad or touchpad, and type a label such as "Magic Trackpad on macOS 15".
3. For each gesture, click it, press Record, do the gesture over the pad once and press Stop. Scroll down and up, pinch out and in, Ctrl+wheel and Shift+wheel are the important ones. Drag, middle drag and the double-clicks matter for a mouse.
4. Press Save JSON. The file is named like `trackpad-macos-chrome.recorded.json`.
5. Move it into `test/input/traces/` and run `pnpm --filter @parfocal/viewer-engine test`. A failing gesture on a real device is a finding, so note it in `docs/log.md` before changing the rules.

Record a mouse, a Mac trackpad and a Windows precision touchpad, in Chrome first. A file holds only event types, deltas, positions, modifier keys and the user agent, never anything about a patient.
