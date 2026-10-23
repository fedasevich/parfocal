# Result: Viv 0.23 on deck.gl 9.4 opens CMU-1.svs and keeps one Deck over 20 slide switches

- Date: 2026-10-23
- Backlog: STACK-015 (Viv and deck.gl versions and the WebGL2 versus WebGPU question)
- Kind: spike
- Commit: 84b603f (the spike lived in a scratch folder outside the repository and is described below)
- Environment: MacBook with Apple M4 (10 cores, 24 GB), macOS 15.8.1, Node 26.9.0, pnpm 12.9.1, Google Chrome 155.0.8059.85 driven headless by playwright-core 1.64.0 with `channel: "chrome"`. WebGL2 reported `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`. Viewport 1600 × 900 CSS pixels at a device pixel ratio of 1. The page was cross-origin isolated. Localhost, no network shaping
- Data: `CMU-1.svs`, `CMU-1-Small-Region.svs` and `CMU-1.tiff` from the OpenSlide test data, fetched with `pnpm fixtures formats`, which found every file already cached and verified

## Question

Which Viv and deck.gl versions should Parfocal pin, does Viv on those versions open CMU-1.svs, and does the viewer pass the 20-slide-switch memory test of STACK-015 and VIEW-030 (heap within 10% of baseline, exactly one `Deck` alive)? Do the two luma.gl problems of POC doc 24 still exist on the current releases: the canvas observer that keeps every finalized deck alive, and the debug string built for every tile sampler?

The POC ran Viv 0.22.1 on deck.gl 9.3 and had to install deck.gl 9.4 a second time in a nested folder for its WebGPU route (POC doc 23). Doc 24 measured main-thread memory after twenty slides falling from 8.9 GB to 211 MB once the canvas context was destroyed.

## Versions found on npm on 2026-10-23

| Package | Latest | Released | Peer or dependency constraint |
|---|---|---|---|
| `@hms-dbmi/viv` | 0.23.0 | 2026-09-23 | pulls `@vivjs/*` 0.23.0 |
| `@vivjs/layers` | 0.23.0 | 2026-09-23 | peers `@deck.gl/core`, `@deck.gl/layers`, `@deck.gl/geo-layers` `~9.4.0` and `@luma.gl/core`, `webgl`, `engine`, `constants`, `shadertools` `~9.4.0` |
| `@vivjs/loaders` | 0.23.0 | 2026-09-23 | depends on `geotiff ^2.0.5` and `zarrita ^0.5.4` |
| `@vivjs/viewers` | 0.23.0 | 2026-09-23 | peers React 16 to 19, `@deck.gl/react` and `@deck.gl/widgets` `~9.4.0` |
| `@hms-dbmi/viv` | 0.22.1 | 2026-08-10 | the POC's version, on deck.gl `~9.3` |
| `@deck.gl/core`, `layers`, `geo-layers` | 9.4.0 | 2026-09-05 | `@luma.gl/*` `^9.4.0` |
| `@luma.gl/core`, `webgl`, `webgpu`, `engine`, `shadertools` | 9.4.2 | 2026-09-19 | `10.0.0-alpha.4` is on the `beta` tag |
| `geotiff` | 3.0.5 | 2026-03-11 | |

## Method

A scratch folder with exact versions `@hms-dbmi/viv@0.23.0`, `@deck.gl/core@9.4.0`, `@deck.gl/layers@9.4.0`, `@deck.gl/geo-layers@9.4.0`, `@luma.gl/{core,webgl,engine,constants,shadertools}@9.4.2`, `geotiff@3.0.5`, `vite@8.3.3` and `playwright-core@1.64.0`. `pnpm install` printed no peer warnings and resolved one copy of each deck.gl and luma.gl package.

1. `vite.config.ts` sets COOP `same-origin` and COEP `credentialless` through `server.headers` and `preview.headers` ([ADR 0015](../adr/0015-vite-build-tool.md)) and adds a middleware that serves `/slides/<name>` from the fixture cache with range requests.
2. `src/tiff-source.ts` is a minimal source of about 120 lines, kept inside the spike because VIEW-003 (PixelSource interface) is being built at the same time. It opens the file with `geotiff.fromUrl`, keeps the tiled directories with the base's aspect ratio as real levels, and builds Viv's power-of-two ladder: virtual level `i` reads from the finest real level no finer than `2^i` and lets `readRasters({ window, width, height, interleave: true, resampleMethod: "nearest" })` scale the window to a 256 px tile. Each level is an interleaved RGB source with `shape [h, w, 3]`, `labels ["y", "x", "_c"]`, `dtype "Uint8"` and the file's `PhotometricInterpretation` in `meta`. Decoding runs on the main thread.
3. `src/main.ts` creates one `Deck` per slide on its own canvas with `deviceProps: { type: "webgl", webgl: { antialias: false } }`, an `OrthographicView`, `useDevicePixels: 1` and one `MultiscaleImageLayer` with `pickable: false` and a stable `selections` array. Opening a slide waits for `onViewportLoad`, then tours four views (fit plus 2 zoom steps, zoom −1, full resolution, fit) and waits for each to load. A wait that does not finish in 15 s is counted as a timeout.
4. The release of the old deck before the next slide has three modes, picked by `?release=`:

   | Mode | What it does |
   |---|---|
   | `stock` | `deck.finalize()`, then remove the canvas |
   | `lose` | `stock` plus `WEBGL_lose_context.loseContext()` and a zero-sized canvas |
   | `wrapper` | `lose` plus `deck.device.canvasContext.destroy()` between `finalize()` and losing the context |

   ```ts
   function disposeDeck(deck: Deck<OrthographicView>, canvas: HTMLCanvasElement) {
     const device = deck.device as unknown as WebGLDeviceLike | undefined;
     deck.finalize();
     device?.canvasContext?.destroy();
     const gl = device?.gl;
     if (gl && !gl.isContextLost()) gl.getExtension("WEBGL_lose_context")?.loseContext();
     canvas.width = 0;
     canvas.height = 0;
     canvas.remove();
   }
   ```

5. `?glkeys=patched` replaces `device.getGLKeys` with a function that returns `{}` in `onDeviceInitialized`, as the POC's `skipGLKeyLogging` did. `?glkeys=stock` wraps it instead and counts calls and their time.
6. `HTMLCanvasElement.prototype.getContext` is wrapped to count WebGL2 contexts created and `webglcontextlost` events, as in the [STACK-002 (React Compiler and StrictMode) spike](2026-10-08-react-compiler-strictmode-spike.md).
7. `memory-test.mjs` builds nothing itself. It runs against `vite build` then `vite preview`. For each mode it opens a fresh browser context, measures the empty page, opens `CMU-1.svs`, then switches 20 times through the cycle `CMU-1.svs`, `CMU-1-Small-Region.svs`, `CMU-1.tiff`, `CMU-1-Small-Region.svs`, so CMU-1.svs is open at visits 0, 4, 8, 12, 16 and 20. After every visit it calls `HeapProfiler.collectGarbage` twice over CDP and records:
   - `Runtime.getHeapUsage` used size (the JavaScript heap),
   - `performance.measureUserAgentSpecificMemory()` bytes, with `--enable-blink-features=ForceEagerMeasureMemory` so the result is immediate (this includes array buffers and DOM memory),
   - live `Deck`, `WebGLDevice` and luma.gl `CanvasObserver` objects, counted with `Runtime.queryObjects` on each prototype,
   - canvases in the document and the context counters.

   It then closes the viewer and measures once more. A mode passes when the heap at the last CMU-1.svs visit is within 10% of the heap after the first CMU-1.svs open, exactly one `Deck` is alive after every visit and none is alive after closing.
8. To check whether the debug-string fix matters on the chosen versions, the `wrapper` modes were run once more with `@luma.gl/webgl` forced to 9.4.1 through a pnpm override, and the luma.gl 9.3.6, 9.4.0 and 9.4.1 tarballs were unpacked to read `WEBGLTexture._setSamplerParameters`.

Commands, in the scratch folder:

```sh
pnpm install
pnpm exec vite build
pnpm exec vite preview --port 4173 --strictPort
OUT=out-run1 node memory-test.mjs wrapper:patched,lose:patched,stock:patched,wrapper:stock
OUT=out-run2 node memory-test.mjs wrapper:stock,stock:stock
OUT=out-run3 node memory-test.mjs wrapper:stock
```

## Results

### CMU-1.svs in Viv

CMU-1.svs (46,000 × 32,914, real levels at 1×, 4× and 16×, JPEG tiles of 256 px) opened and drew at fit and at full resolution with correct H&E colours, judged by eye from the screenshots. CMU-1-Small-Region.svs and CMU-1.tiff drew too. No run logged a page error or a console error, and no load wait timed out.

Time from `open()` to the first loaded viewport, main-thread decoding, run 3 (`wrapper:stock`):

| Slide | Visits | Min ms | Median ms | Max ms |
|---|---|---|---|---|
| CMU-1.svs | 6 | 1,099 | 1,594 | 2,252 |
| CMU-1-Small-Region.svs | 10 | 1,669 | 2,228 | 2,764 |
| CMU-1.tiff | 5 | 399 | 444 | 599 |

The production bundle's main chunk was 1,152,953 bytes minified.

### The 20-switch memory test

Heap is `Runtime.getHeapUsage` in MB, UASM is `measureUserAgentSpecificMemory` in MB. "Baseline" is after the first CMU-1.svs open and "last" is after switch 20, which opens CMU-1.svs again. luma.gl webgl is 9.4.2 unless the run says 9.4.1.

| Run | Release | GL keys | Heap baseline | Heap last | Growth | UASM baseline | UASM last | Most Decks alive | Decks after close | Heap empty / closed | UASM closed | Contexts created / lost | `getGLKeys` calls | `getGLKeys` ms | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | wrapper | patched | 13.5 | 14.1 | 4.4% | 82.1 | 82.6 | 1 | 0 | 3.8 / 6.9 | 20.2 | 21 / 21 | 0 | 0 | pass |
| 1 | lose | patched | 13.5 | 107.5 | 696% | 82.1 | 985.9 | 21 | 21 | 3.8 / 107.0 | 985.4 | 21 / 21 | 0 | 0 | fail |
| 1 | stock | patched | 13.5 | 107.5 | 696% | 82.1 | 1,209.1 | 21 | 21 | 3.8 / 107.0 | 1,208.6 | 21 / 5 | 0 | 0 | fail |
| 1 | wrapper | stock | 13.5 | 14.1 | 4.4% | 82.1 | 82.7 | 1 | 0 | 3.8 / 6.9 | 20.1 | 21 / 21 | 0 | 0 | pass |
| 9.4.1 | wrapper | stock | 13.6 | 14.1 | 3.7% | 82.1 | 82.7 | 1 | 0 | 3.8 / 6.9 | 20.2 | 21 / 21 | 2,132 | 993 | pass |
| 9.4.1 | wrapper | patched | 13.5 | 14.1 | 4.4% | 82.0 | 82.7 | 1 | 0 | 3.8 / 6.9 | 20.2 | 21 / 21 | 0 | 0 | pass |
| 2 | wrapper | stock | 13.5 | 14.1 | 4.4% | 82.1 | 82.7 | 1 | 0 | 3.8 / 6.9 | 20.2 | 21 / 21 | 0 | 0 | pass |
| 2 | stock | stock | 13.6 | 107.6 | 691% | 82.1 | 1,209.1 | 21 | 21 | 3.8 / 107.1 | 1,208.6 | 21 / 5 | 0 | 0 | fail |
| 3 | wrapper | stock | 13.6 | 14.1 | 3.7% | 82.1 | 82.6 | 1 | 0 | 3.8 / 6.9 | 20.2 | 21 / 21 | 0 | 0 | pass |

In every run the live `WebGLDevice` and `CanvasObserver` counts equalled the live `Deck` count.

Every CMU-1.svs visit, run 3 (`wrapper:stock`) against run 2 (`stock:stock`):

| Visit | Wrapper heap | Wrapper UASM | Wrapper Decks | Stock heap | Stock UASM | Stock Decks |
|---|---|---|---|---|---|---|
| open | 13.6 | 82.1 | 1 | 13.6 | 82.1 | 1 |
| switch 4 | 13.8 | 82.4 | 1 | 32.9 | 311.8 | 5 |
| switch 8 | 14.1 | 82.6 | 1 | 51.7 | 536.3 | 9 |
| switch 12 | 14.1 | 82.7 | 1 | 70.3 | 760.6 | 13 |
| switch 16 | 14.1 | 82.7 | 1 | 89.0 | 984.9 | 17 |
| switch 20 | 14.1 | 82.6 | 1 | 107.6 | 1,209.1 | 21 |

### The luma.gl source

| luma.gl webgl | `_setSamplerParameters` |
|---|---|
| 9.3.6 (the POC) | calls `log.log(2, ..., this.device.getGLKeys(parameters))()` unconditionally |
| 9.4.0 | same |
| 9.4.1 | same |
| 9.4.2 | wraps the call in `if (log.level >= 2)` in the ESM, CommonJS and dev bundles |

In deck.gl 9.4.0, `Deck.finalize()` destroys the animation loop, managers and its own canvas if it created one, but never the device or `device.canvasContext`. `Deck._createDevice` passes `_reuseDevices: true` to `luma.createDevice`, and `WebGLDevice.destroy()` does nothing when that flag is set. luma.gl 9.4.2's `CanvasObserver.stop()` is still the only place that removes the `(resolution: Ndppx)` media query listener and disconnects the resize and intersection observers, and only `CanvasContext.destroy()` calls it.

## Interpretation

- Viv 0.23.0 runs on deck.gl 9.4.0 and luma.gl 9.4.2 with one copy of each. Assumption, not tested here because no WebGPU route was built: a deck.gl 9.4 WebGPU route can then share that copy, and the POC's nested deck.gl 9.4 install and Vite pre-bundling exclusions of doc 23 are no longer needed.
- The doc 24 leak is still present upstream. Without `canvasContext.destroy()` every finalized deck stays alive with its device and canvas observer, and memory grows on average by about 56 MB of UASM and 4.7 MB of heap per switch over these three slides. Losing the WebGL context alone does not help, which matches doc 24's finding that the observer, not the context, holds the deck. With the wrapper exactly one deck is alive, the heap at the last CMU-1.svs visit is 3.7% to 4.4% over the first and flat from switch 8 onwards, and closing leaves no deck.
- In the `stock` release Chrome lost 5 of 21 contexts on its own, which is the 16-context limit seen in the STACK-002 (React Compiler and StrictMode) spike, while all 21 decks stayed reachable.
- The debug-string cost is fixed upstream from luma.gl 9.4.2. On 9.4.1 the same run built the string 2,132 times for 993 ms of main-thread time. On 9.4.2 it was never built, with or without the POC's patch.
- The memory test can fail: both release modes without `canvasContext.destroy()` fail it by a factor of seven on the heap.
- Assumption: the heap after closing (6.9 MB against 3.8 MB on the empty page) is loaded code and module state, not slide data, because no `Deck`, device or observer is alive and UASM fell to 20 MB.
- The test ran on a real GPU through ANGLE Metal. Hosted Linux CI uses SwiftShader ([ADR 0011](../adr/0011-hosted-ci-only.md)) and was not measured here.

## Follow-ups

- [ADR 0098](../adr/0098-viv-and-deck-gl-versions.md) records the versions, the WebGPU route and how the luma.gl fixes are applied.
- VIEW-030 (memory and teardown correctness) should reuse the `Runtime.queryObjects` Deck count and the `stock` release as the canary that shows the wrapper is still needed.
- VIEW-031 (luma.gl debug-string cost patch) needs no patch on luma.gl 9.4.2. Its perf test stays as a regression check.
- TODO: run the same test on hosted Linux CI with SwiftShader for VIEW-030 (memory and teardown correctness).
- TODO: Viv's `@vivjs/loaders` depends on `geotiff ^2` while STACK-016 (TIFF and Zarr readers in the browser) is expected to choose geotiff 3, so the bundle may carry two geotiff copies. Measure it when VIEW-002 (Viv route for RGB brightfield) imports only the layers.
- TODO: report upstream that `Deck.finalize()` leaves the device's canvas context running (owner to decide whether to file it).
