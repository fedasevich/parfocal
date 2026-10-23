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
