# Web build

Lessons about bundling the web app, its workers and WebAssembly with Vite ([ADR 0015](../adr/0015-vite-build-tool.md)), and about the Viv, deck.gl and luma.gl stack ([ADR 0098](../adr/0098-viv-and-deck-gl-versions.md)).

## onnxruntime-web needs wasmPaths in a bundled worker

When a worker imports onnxruntime-web, Vite inlines its WebAssembly glue into the worker chunk. onnxruntime-web starts its thread pool by loading the current script again, so every thread worker runs the application's worker code. An `onmessage` handler there takes onnxruntime-web's internal "load" message as an application request, and the session never finishes. There is no error. Set the paths so the threads load onnxruntime-web's own file:

```ts
import mjs from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";

ort.env.wasm.wasmPaths = { mjs, wasm };
```

Use the `jsep` or `jspi` files instead when importing those builds. Source: [STACK-001 spike](../results/2026-10-08-vite-worker-wasm-spike.md).

## Vite 8 applies server.headers to modules and workers

The POC needed a middleware plugin for COOP and COEP because `server.headers` skipped transformed modules, and Chrome silently refused the module worker. In Vite 8.3, `server.headers` and `preview.headers` reach the HTML, modules, worker scripts and public files, and the worker runs isolated. Source: [STACK-001 spike](../results/2026-10-08-vite-worker-wasm-spike.md).

## Headless Chrome on a Mac has real WebGPU

playwright-core with `channel: "chrome"` drives the installed Chrome without downloading a browser, and with `--enable-unsafe-webgpu` headless pages get the `apple metal-3` adapter. Hosted Linux CI does not, which is why golden images use SwiftShader there ([ADR 0011](../adr/0011-hosted-ci-only.md)).

## StrictMode exposes a leaking canvas host on the first mount

In development StrictMode mounts, unmounts and remounts every effect. A viewer host whose cleanup does not destroy the engine shows two WebGL contexts and two canvases right after the first mount. A production build hides that until Chrome forcibly loses contexts once 16 are alive. Count contexts by wrapping `HTMLCanvasElement.prototype.getContext` and listening for `webglcontextlost`. Source: [STACK-002 spike](../results/2026-10-08-react-compiler-strictmode-spike.md).

## Viv 0.23 and deck.gl 9.4 share one install

Viv 0.23.0 peers on deck.gl `~9.4.0` and luma.gl `~9.4.0`, so a deck.gl 9.4 WebGPU route no longer needs the POC's second, nested deck.gl copy. Viv's layers are still GLSL only, so Viv itself runs on WebGL2. Pin deck.gl and luma.gl exactly and move them only with a Viv release whose peers allow the new version. Source: [ADR 0098](../adr/0098-viv-and-deck-gl-versions.md).

## Deck.finalize() still leaks every old deck

In deck.gl 9.4.0 with luma.gl 9.4.2, `Deck.finalize()` never destroys `deck.device.canvasContext`, whose canvas observer keeps a media query listener and resize and intersection observers. Each finalized deck then stays reachable with its device, layers and textures. Losing the WebGL context and removing the canvas does not help. `device.destroy()` does not help either, because deck.gl creates its device with `_reuseDevices: true`, which turns `destroy()` into a no-op. Dispose in this order: `deck.finalize()`, `deck.device.canvasContext.destroy()`, `WEBGL_lose_context.loseContext()`, zero the canvas size, remove the canvas. In the spike, 20 switches without the canvas context step left 21 decks alive and grew the heap sevenfold. Source: [STACK-015 spike](../results/2026-10-23-viv-version-spike.md).

## Count live decks with Runtime.queryObjects

Expose `Deck.prototype` on the page and call CDP `Runtime.queryObjects` with it after `HeapProfiler.collectGarbage`. The returned array's length is the number of live decks. The same works for luma.gl's `WebGLDevice` and `CanvasObserver` prototypes, taken from the device in `onDeviceInitialized`. `performance.measureUserAgentSpecificMemory()` needs a cross-origin isolated page, and `--enable-blink-features=ForceEagerMeasureMemory` makes it answer at once instead of after the next scheduled GC. Source: [STACK-015 spike](../results/2026-10-23-viv-version-spike.md).

## luma.gl 9.4.2 no longer builds the sampler debug string

luma.gl 9.3.6, 9.4.0 and 9.4.1 call `device.getGLKeys` for every texture sampler to build a log message that is never printed, which cost 993 ms over 20 slide switches on 9.4.1. From 9.4.2 the call sits behind `if (log.level >= 2)`. Keep luma.gl at 9.4.2 or later instead of patching `getGLKeys`. Source: [STACK-015 spike](../results/2026-10-23-viv-version-spike.md).

## geotiff returns raw YCbCr for JPEG TIFFs with photometric 6

`readRasters` on CMU-1.tiff (JPEG tiles, `PhotometricInterpretation` 6) returns YCbCr samples, and the slide draws pink and teal when they are treated as RGB. Aperio SVS files store photometric 2 and come out as RGB. Pass the file's photometric value in the source's `meta.photometricInterpretation`, and Viv's bitmap shader converts YCbCr, or convert in the reader. Source: [STACK-015 spike](../results/2026-10-23-viv-version-spike.md).

## The React profiler counts nothing in a production build

`<Profiler onRender>` never fires in a production build of React DOM, so a render count taken there is zero whatever the components do. Alias `react-dom/client` to `react-dom/profiling` in the Vite config to keep production code paths and still count renders. Check the counter with a control that is known to render. Source: [STACK-006 spike](../results/2026-10-23-hot-path-state-spike.md).

## Read the camera through a selector

`useSyncExternalStore(engine.subscribeCamera, engine.getCamera)` re-renders the component on every camera notification, which is once per frame while panning (120 renders in a 3 s pan). Select what the component shows, such as `() => Math.round(engine.getCamera().zoom * 100) / 100`, and it renders only when that value changes (0 renders in the same pan). Source: [STACK-006 spike](../results/2026-10-23-hot-path-state-spike.md), [ADR 0100](../adr/0100-viewer-hot-path-state-outside-react.md).

## Headless Chrome does not deliver synthetic input every frame

Mouse moves sent through `Input.dispatchMouseEvent` at 120 Hz arrived as about 80 `pointermove` events per second, about 50 under a 4x CPU throttle, and the camera changed on only two frames in three. Playwright's `page.mouse.move` waits for each move and reached about 60 per second. A pan driven that way does not load the renderer on every frame. To test per-frame cost, also drive the camera from a `requestAnimationFrame` loop in the page. Source: [STACK-006 spike](../results/2026-10-23-hot-path-state-spike.md).

## Viv calls getRaster on a tiled source

A `MultiscaleImageLayer` over a source that only implemented `getTile` threw from `getRaster` when the slide opened. Every level of a PixelSource handed to Viv needs a working `getRaster`. Source: [STACK-006 spike](../results/2026-10-23-hot-path-state-spike.md).

## Engine methods must not need this

React calls the `subscribe` and `getSnapshot` functions given to `useSyncExternalStore` unbound. The viewer engine returns closures rather than class methods, so `engine.subscribeCamera` can be passed as it is. Keep it that way when the engine grows. Source: VIEW-001, [ADR 0100](../adr/0100-viewer-hot-path-state-outside-react.md).

## Viv addresses levels as exact powers of two

`MultiscaleImageLayer` asks loader entry `i` for tile `z = -i` and places it as a `2^i` downsample, using the tile's own width and height for its bounds. Aperio stores 1x, 4x and 16x, so the route builds a virtual ladder (`virtualLadder` in `src/viv/viv-levels.ts`) where each `2^i` entry reads the finest real level not finer than it and box-averages by the residual factor. For CMU-1.svs that is nine entries, the last averaging the 16x level by 16. A short edge tile must keep its true size, or the edge stretches. Source: VIEW-002, [ADR 0102](../adr/0102-viv-route-feeds-a-virtual-rgb-ladder.md).

## Tell Viv the planes are RGB, because the source already converted them

The PixelSource returns RGB for YCbCr files (`readRGB`), so the route sets `meta.photometricInterpretation` to 2 on every level. Setting 6 as well would convert twice. Handing Viv unconverted Y, Cb and Cr as RGB misses the CMU-1.svs goldens by 6.5 to 94 levels of mean error. Source: VIEW-002, [result](../results/2026-10-23-viv-route-goldens.md).

## Aborted Viv tiles must reject with Viv's sentinel string

Viv catches `"__vivSignalAborted"` from `getTile` and `getRaster` and drops it silently. Any other rejection from the background `getRaster` becomes an unhandled rejection in the page. The sentinel is not exported by `@hms-dbmi/viv`, so `viv-levels.ts` holds the string, typed as `unknown` so that `only-throw-error` accepts throwing it. Source: VIEW-002.

## Viv's prop types reject pickable and need dtype

`new MultiscaleImageLayer<[]>({...})` type-checks only with `dtype` set and without `pickable`, although the layer accepts `pickable` at runtime and defaults it to `true`. The route spreads `{ pickable: false }` typed as `object`. Source: VIEW-002.

## Wait for idle before capturing a Viv frame

A golden capture needs the layer loaded, no tile read in flight and nothing left for deck to draw. `onViewportLoad` alone fires before the background `getRaster` of the coarsest level finishes. The route's `whenIdle()` checks `layer.isLoaded`, its own in-flight count and `deck.needsRedraw({ clearRedrawFlags: false })` on two calm frames in a row. With that, CMU-1.svs frames were byte-identical over five SwiftShader runs. Source: VIEW-002, [result](../results/2026-10-23-viv-route-goldens.md).

## Turborepo strips environment variables from browser suites

Turborepo runs tasks in strict environment mode, so `PARFOCAL_REQUIRE_FIXTURES`, `PARFOCAL_FIXTURES_DIR`, `XDG_CACHE_HOME`, `GOLDEN_UPDATE` and `GOLDEN_MEASURE` reach `test:browser` only because `turbo.json` lists them in `passThroughEnv`. Add any new variable a browser suite reads there, or it is silently unset under `pnpm test:browser`. Source: VIEW-002.

## Measure the memory test after a warm-up cycle

On SwiftShader with the CI slides the JavaScript heap grew 12.7% from the first slide open to the 20th switch with exactly one `Deck` alive throughout. Heap snapshots put 82% of that in V8 compiled code, built while each reader, codec and Viv path ran for the first time, and the heap was flat from the tenth visit on. The memory test therefore opens every slide once before it takes the baseline. Use `MEMORY_SNAPSHOTS=0,5,20` on the memory spec to write snapshots and diff them by node type when the heap grows again. Source: VIEW-030, [result](../results/2026-10-23-memory-teardown-swiftshader.md), [ADR 0103](../adr/0103-memory-settings-and-test-baseline.md).

## A finalized deck can outlive dispose by one task

Right after `disposeDeck` one `Deck` was sometimes still reachable through `Runtime.queryObjects`, while its device and canvas context were already gone, and it was collected by the next count. Count after dispose more than once, or poll, before calling it a leak. A leak keeps the device and canvas context too. Source: VIEW-030.

## A deck disposed before its device exists leaks the device

deck.gl creates its luma.gl device asynchronously. When `finalize()` runs first, `deck.device` is still null and the device that arrives later keeps its canvas context and observer alive. `disposeDeck` reads the pending device from `deck.animationLoop.props.device` and releases it when it resolves. Source: VIEW-030.

## Viv's uint8 textures and r8unorm

Viv 0.23's `XRLayer` uploads `Uint8` channels as `r8uint` with nearest filtering and as an `r32float` copy with linear filtering, and its shader applies contrast limits in 0 to 255. `installUint8TextureUpload(XRLayer)` uploads `r8unorm`, switches the sampler to `sampler2D` and multiplies the intensity by 255 in the `DECKGL_PROCESS_INTENSITY` hook, which drew within 1 level of Viv's frames. `XRLayer` used on its own needs a `selections` prop, or the colour palette extension counts zero channels and also draws black. Interleaved RGB goes through Viv's `BitmapLayer` as `rgba8unorm` and is not affected. Source: VIEW-030, [ADR 0103](../adr/0103-memory-settings-and-test-baseline.md).

## Playwright empties test-results before a run

Playwright clears its output folder, `test-results/` by default, at the start of every run. The memory spec writes its JSON reports and heap snapshots there, so copy them elsewhere before the next run if they are needed. Source: VIEW-030.

## Clamp a camera target before deriving anything from it

An eased zoom about the cursor computes the centre from the zoom on each frame. When the target zoom lies outside the limits, the clamp changes the zoom but not the centre that was derived for it, and the view slides sideways on every frame while the zoom chases a value it never reaches. The POC hit this. The camera controller clamps every target with `clampZoom` or `clampCamera` first and derives the anchor or flight path from the clamped value. Source: VIEW-020, [ADR 0104](../adr/0104-camera-controller-motion.md).

## Integrate camera decays exactly so tests do not depend on the frame rate

Coasting and the eased zoom use the closed form of an exponential decay for each frame's elapsed time instead of a per-frame factor. Thirty frames at 60 Hz, sixty at 120 Hz and one step of 500 ms then give the same position, so unit tests drive the controller with a fake clock and any frame length. The engine takes the clock as the `now` option and runs the controller inside its own frame, before it notifies camera subscribers. Source: VIEW-020, [ADR 0104](../adr/0104-camera-controller-motion.md).

## The van Wijk flight needs asinh, not the log form

The zoom and pan path's `r` terms are usually written `log(sqrt(b² + 1) - b)`. For a flight that zooms far out with a short pan, `b` grows past 10^8, `sqrt(b² + 1)` rounds to `b`, and the log of zero turns the whole path into NaN. A flight from 16 screen pixels per slide pixel out to 1/512 with a pan of 10 slide pixels did that. The same value is `-asinh(b)`, which stays accurate at any size. Source: VIEW-042, [ADR 0106](../adr/0106-camera-bounds-and-feel-profiles.md).

## End a coast at a computed time, not on a speed threshold

A coast checked against its stop speed at frame times keeps moving until the first frame after the speed crosses it, so the end position depends on the frame rate. With a 130 ms decay and a 0.01 px/ms stop speed the difference reached 0.25 px between 30 Hz and 1 ms frames. The controller computes the time the speed reaches the threshold when the coast starts and integrates the last step exactly up to it. An eased zoom does not need this, because it snaps onto its target. Source: VIEW-042, [ADR 0106](../adr/0106-camera-bounds-and-feel-profiles.md).

## Advance a running motion to the input's time before handling the input

Between frames the camera holds the value of the last frame. A wheel step, pan or cancel that reads it acts on a state that depends on when that frame ran, so the same input script ends in different places at 30 and 120 Hz. Every controller input first steps the running motion to the clock's current time. Removing that step made the smoothness suite fail, for example with a 45 px jump between two frames where the reference moved the content 6 px. Source: VIEW-045, [ADR 0106](../adr/0106-camera-bounds-and-feel-profiles.md).

## Test camera smoothness against a 1 ms run, following content points

`test/camera-smoothness.test.ts` plays each input script at 30, 60 and 120 Hz and with jittery frame times, and once at 1 ms frames as the reference. A frame-to-frame jump is allowed only up to how far the same content travels on screen along the reference over that interval, widened by 1 ms on each side, plus 1% and 0.5 px. Two traps came up while writing it. Measuring how far the screen corners move understates a zoom in, because the content under a corner moves `k - 1` while the summed small steps give `ln k`. Ending the reference path at the first sample after a frame is not a bound either, when an input lands at almost the same time as the frame. Source: VIEW-045.

## Decode workers must share one byte cache

geotiff reads 1 MiB blocks, and one block of CMU-1.svs holds many tiles. Six workers that each open the slide with their own geotiff source download a shared block up to six times. The decode workers instead fetch through a `MessagePort` to one range cache on the page (`src/decode/range-cache.ts`), and `createPixelSlideOpener` opens the page's own source through the same cache. A pan across CMU-1.svs then downloaded no byte twice. Source: VIEW-004, [ADR 0105](../adr/0105-decode-workers-behind-one-byte-cache.md), [result](../results/2026-10-23-decode-pool-pan-fetches.md).

## Never abort a download the viewer started

Viv aborts a tile's signal as soon as it leaves the view. If that signal reaches `fetch`, a source slower than a frame never delivers anything to a caller that re-asks every frame: 160 fetches and no finished tile in 40 frames. The decode pool drops only queued jobs, lets running ones finish and keeps their results for the next request, and the range cache never passes a signal to the network. Source: VIEW-004, [result](../results/2026-10-23-decode-pool-pan-fetches.md).

## Run the decode worker in Node through a MessageChannel

`startDecodeWorker` takes any object with `postMessage(message, transfer)` and `addEventListener("message")`, so a Node `MessageChannel` port can host it in the test process, with transfers and a nested `MessagePort` for the byte relay. The tests call `start()` on both ports. The unit tests compare every tile from the pool with the page's own reader this way. Source: VIEW-004.

## Count aborted fetches at the latency proxy

In the fetch storm test, 160 requests the client aborted during the proxy's RTT delay were counted by `@parfocal/latency-proxy`, and none of them reached the origin server's log. To count fetches in an abort scenario, read the proxy's `stats()`. Source: VIEW-004.

## Coalesced pointer samples need their own times

`getCoalescedEvents()` hands back every sample of a fast stroke, but fed to the camera controller at the time of the event that carried them they all share one timestamp and the release velocity comes out as if they were not there. The input binding passes each sample's age (`event.timeStamp - sample.timeStamp`), and `dragTo` turns that into a time on the engine's own clock. In the unit test a stroke delivered late as four coalesced samples threw more than 50 px further than the same stroke without them. Source: VIEW-043, [ADR 0107](../adr/0107-viewer-input-binding.md).

## Replay input in Node against the real camera controller

The gesture interpreter returns actions instead of touching the DOM, so `test/input/replay.ts` feeds a trace through it into `createCameraController` with a fake clock and steps a frame every 16.7 ms between events. Anchoring, the per-event zoom cap and the end of every gesture are then checked frame by frame without a browser. Add new trace files to `test/input/traces/` and they are replayed automatically. Source: VIEW-021, [ADR 0107](../adr/0107-viewer-input-binding.md).

## A synthetic drag can throw

Moves sent through `Input.dispatchMouseEvent` with a wait between them and released straight after the last one count as a throw, and the camera coasts past the pointer's travel. A browser test that checks a pan distance should wait for idle and assert at least the travel, or release after more than 60 ms of rest. Source: VIEW-021.

## Playwright keeps every page focused

Playwright emulates focus, so a headless page does not lose it when another page opens. The input spec ends a drag on blur by dispatching a `FocusEvent("blur")` on the window, which runs the same handler a real blur does. Source: VIEW-043.

## One interleaved array means one decode per Viv tile

The Viv route sets one selection and an interleaved RGB array of shape y, x and 3, so Viv asks for each region once and never for separate R, G and B planes. A browser test counts the reads of CMU-1.svs behind a counting source (31 reads for 31 regions fitted, 25 for 25 at 10x, none twice). The POC's decode cache for three channels is not needed on this route. Source: VIEW-006, [ADR 0110](../adr/0110-native-jpeg-decode-and-tissue-fit.md).

## A tissue box that fills the slide barely changes the fit

The ingest mask of CMU-1.svs has a bounding box 5 to 7 percent smaller than the slide on each axis, because a few stray cells sit near the edges. With a 5 percent margin the fit zooms in 2.3 percent. A fit-to-tissue golden on a nearly full slide shows the rule working but not much else. Use a slide with real empty glass for a visible check. Source: VIEW-048.

## Binary polygon loops need two extra vertices, and indices are absolute

deck.gl's `PathLayer` with `_pathType: "loop"` and binary `getPath` expects each ring as its vertices plus the first two vertices again, and `startIndices` that count them. deck.gl sizes a loop at its vertex count plus two in `getGeometrySize`, so the buffer has to hold them. For `SolidPolygonLayer` with `_normalize: false`, `data.attributes.indices` holds triangle indices into the whole position buffer, not into each polygon, and per-vertex colour attributes need exactly one entry per stored vertex. An early comparison with `_normalize: true` and per-vertex colours drew about 3% of the pixels differently from the precomputed layer, most likely because normalizing adds a closing vertex to each ring and the colour attribute keeps the original count (not confirmed in deck.gl's code). To compare against deck.gl's own triangulation, drop `indices` and keep `_normalize: false`. Source: VIEW-026, [result](../results/2026-10-25-overlay-polygon-indices.md), [ADR 0108](../adr/0108-overlay-layers-as-typed-data-over-deck-gl.md).

## Triangle indices cut a 1M polygon layer update from 261 ms to 39 ms

Running earcut once when a polygon batch is built and passing the indices to `SolidPolygonLayer` took the layer's `updateState` for 1M octagons from 261 ms to 39 ms in Chrome on SwiftShader, with identical pixels. The batch itself takes 273 ms, so it pays off from the second update and should not run on the main thread for large result sets. Source: VIEW-026, [result](../results/2026-10-25-overlay-polygon-indices.md).

## Hide with visible false, remove by leaving the list

A deck.gl layer with `visible: false` keeps its models and GPU buffers and costs nothing to show again. A layer that leaves the `layers` array has `finalizeState` called, which destroys its models and attribute buffers. The overlay golden spec checks both through `layerManager.getLayers()`, reading `destroyed` on buffers and `_destroyed` on luma.gl models, which have no `destroyed` getter. Source: VIEW-026.

## ImageData is enough for a BitmapLayer image and an IconLayer atlas

Both layers take an `ImageData` for `image` and `iconAtlas` and load it without an asynchronous fetch, but their textures are still created on the first frame, so a golden capture must wait for `layer.isLoaded` of every overlay layer as well as the slide. The Viv route's `whenIdle` does. Draw the icon atlas in code, from a signed distance function, instead of with a canvas, so that no font or anti-aliasing difference between machines reaches a golden. For a `BitmapLayer` in the engine's y-down view the bounds are `[left, bottom, right, top]` with bottom as the larger y, and a raster test needs an asymmetric image to notice a flip. Source: VIEW-026.

## Headless Chrome cannot be hidden, so a hidden tab test emulates it

With Playwright 1.64 and Chrome 155, `bringToFront` on a second page, a minimized window (`Browser.setWindowBounds`), `Page.setWebLifecycleState` frozen then active, and launching without Playwright's three backgrounding flags all left `visibilityState` at `visible` with rAF at 60 Hz. The protocol Playwright ships has no visibility command. `browser/page/frame-probe.ts` overrides `document.visibilityState`, dispatches `visibilitychange`, withholds animation frames (held until shown, or dropped as in a worker) and floors timers at 1 s while hidden. Install it before the app code, and say in any result that the hidden tab was emulated. Source: VIEW-033, [ADR 0109](../adr/0109-idle-means-zero-frames-and-hidden-tabs-keep-loading.md).

## luma.gl 9.4 lets a Deck's animation loop take its frames from a provider

`Deck` builds its `AnimationLoop` in the constructor and requests the first frame only after the device exists, so `deck.animationLoop.setProps({ animationFrameProvider })` right after `new Deck()` replaces every frame request without touching private methods. The prop is experimental. `src/viv/deck-sleep.ts` parks the loop's callback after 3 frames with nothing to do and hands it back to a real frame on a wake. `cancelAnimationFrame` must drop a parked callback, or the stopped loop keeps its `Deck` reachable. Source: VIEW-032.

## A sleeping Deck loop needs a wake from every source of change

Nothing redraws a parked loop, so every route to new pixels must wake it: camera and slide changes, every finished tile read (a tile that resolves while the loop sleeps only sets deck flags), a canvas resize in device pixels, and a device pixel ratio change through a `matchMedia` resolution query. `whenIdle` also wakes it, which would hide a missed wake, so the route counts a poll that finds work left as a rescue and the tests assert zero. Under CDP, `Emulation.setDeviceMetricsOverride` with only a new `deviceScaleFactor` fires no resize observer and no media query event. Change the size too. Source: VIEW-032.

## Chrome's own 10 s task makes raw TaskDuration unfit for an idle budget

An idle page with a loaded slide showed 5 to 31 ms of `TaskDuration` in 10 s with no script, layout or frame. A `toplevel` trace shows one task from `base/allocator/partition_alloc_support.cc` per window, Chrome's periodic memory reclaimer, whose cost grows with the heap (a blank page: 0.2 to 2.3 ms). Start a trace with `browser.startTracing(undefined, { categories: ["toplevel"] })`, sum the `ThreadControllerImpl::RunTask` events on `CrRendererMain` and split them by `args.src_file`. Wait 2 s after the last frame before the window, or the final compositor work lands in it. Source: VIEW-032, [result](../results/2026-10-25-idle-and-hidden-tab.md).

## deck.gl issues tile requests from setTimeout(0)

loaders.gl's `RequestScheduler`, which deck.gl's `TileLayer` uses, starts requests from `setTimeout(..., 0)`. In a hidden tab those timers wait up to 1 s, so a load hidden before its first read restarts slowly (609 to 738 ms to finish after the tab returned). Reads that have started finish normally, and the route runs one frame as a task per finished read to request the next ones. Source: VIEW-033.

## Right after a camera change the view looks settled

`route.isSettled()` is true straight after `setCamera`, because the synchronous redraw clears the flags and `TileLayer` has not selected the new tiles yet. A test that must wait for new tiles should wait for `isSettled()` and the loop being asleep, which needs 3 quiet frames, or use `whenIdle`, which needs 2. Source: VIEW-033.

## A rejected tile counts as loaded in deck.gl 9.4

`Tile2DHeader` sets `_isLoaded` before it calls `onError`, so one failing tile does not keep a sleeping loop awake. Source: VIEW-032.
