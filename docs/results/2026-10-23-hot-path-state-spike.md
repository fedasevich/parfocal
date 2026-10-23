# Result: camera state outside React while panning a Viv slide

- Date: 2026-10-23
- Backlog: STACK-006
- Kind: spike
- Commit: 84b603f plus the uncommitted VIEW-001 engine in `packages/viewer-engine/src` (the spike app lived in a scratch folder outside the repository and is described below)
- Environment: MacBook with Apple M4 (10 cores), macOS 15.8.1, Node 26.9.0, Google Chrome 155.0.8059.85 driven headless by playwright-core 1.64.0, WebGL renderer `ANGLE (Apple, ANGLE Metal Renderer: Apple M4, Unspecified Version)`, measured refresh 60 Hz, viewport 1600 × 1040 at device pixel ratio 1, served by `vite preview` on localhost
- Data: CMU-1.svs from the OpenSlide test data (46,000 × 32,914, SHA-256 matching `packages/test-fixtures/fixtures.json`), linked from the POC's `public/data/formats`

## Question

Can a Viv slide pan at 60 fps while a React inspector shows the zoom level, with zero React renders per frame, measured with the React profiler (STACK-006)? As a control, how often does the same inspector render when it reads the whole camera?

## Method

The app is React 19.3.0 and React DOM 19.3.0 under `<StrictMode>`, built by Vite 8.3.3 with `@vitejs/plugin-react` 6.1.2 as a minified production build. `react-dom/client` is aliased to `react-dom/profiling`, because `<Profiler onRender>` only fires in a profiling build. Viv 0.22.1, deck.gl 9.3.11, luma.gl 9.3.6 and geotiff 3.0.5 are the POC's versions. STACK-015 may change them.

- The engine is the VIEW-001 `createViewerEngine` from this worktree, imported through a Vite alias.
- The renderer route creates a canvas and a `Deck` with an `OrthographicView` and no deck controller, draws one `MultiscaleImageLayer` with three channels (red, green, blue) and `pickable: false`, and applies the POC's `getGLKeys` patch. `setCamera` calls `deck.setProps({ viewState })`.
- The slide source is a minimal one written for the spike. It opens the SVS with geotiff `fromUrl` and a four-worker decode `Pool`, keeps the tiled images as real levels (1×, 4× and 16×), and presents 2^i virtual levels to Viv with 256-pixel tiles, each read from the finest real level with `readRasters({ window, width, height, resampleMethod: "nearest" })` and cached per tile.
- A pan handler subscribes to the engine's pointer events and moves the camera so the slide point under the pointer stays put. A wheel handler zooms around the pointer.
- The inspector is wrapped in `<Profiler id="inspector">`, the viewer host in `<Profiler id="host">` and the app in `<Profiler id="app">`, and each `onRender` call is counted. In `selector` mode the inspector reads `useSyncExternalStore(engine.subscribeCamera, () => Math.round(engine.getCamera().zoom * 100) / 100)`. In `naive` mode it reads `useSyncExternalStore(engine.subscribeCamera, engine.getCamera)` and rounds while rendering.
- A probe counts `requestAnimationFrame` callbacks, `long-animation-frame` entries, deck's `onAfterRender` calls, pointer moves the engine delivered and camera notifications.

A playwright-core script (`channel: "chrome"`, headless) loads the page in each mode, opens the slide, waits until no tile has been read for 1.5 s, sets the CPU throttle through `Emulation.setCPUThrottlingRate` and runs these scenarios:

| Scenario | What it does |
|---|---|
| cold pan | from camera (28,000, 6,000) at zoom −2 (10×), presses the mouse and sends `Input.dispatchMouseEvent` moves at 120 Hz for 3 s over 1,200 × 400 screen pixels, into tiles not yet read |
| warm pan | the same pan again from the same camera, after its tiles have loaded |
| scripted cold | from (6,000, 20,000) at zoom −1 (20×), a `requestAnimationFrame` loop in the page calls `setCamera` on every frame for 3 s, moving 6,000 × 1,500 slide pixels, into tiles not yet read |
| scripted warm | the same loop again after its tiles have loaded |
| wheel zoom | from (30,000, 9,000) at zoom −3, 30 wheel events of −40 every 16 ms, then 200 ms of quiet |

The matrix was CPU throttle 1× and 4×, each mode, three repeats. Two earlier exploratory runs drove the pans with Playwright's `page.mouse.move` and had no scripted glide. They are not reported here.

## Results

Each cell lists the three repeats. Inspector and host renders are `onRender` calls during the scenario. The app profiler counted exactly the inspector's renders in every run, because nothing else rendered.

| Throttle | Scenario | Mode | Frames | fps | Longest frame, ms | Deck renders | Camera notifications | Inspector renders | Host renders |
|---|---|---|---|---|---|---|---|---|---|
| 1× | cold pan | selector | 180, 180, 180 | 60, 60, 60 | 16.8, 16.8, 16.8 | 122, 122, 122 | 121, 121, 121 | 0, 0, 0 | 0, 0, 0 |
| 1× | cold pan | naive | 180, 181, 180 | 60, 60, 60 | 16.8, 16.8, 16.8 | 122, 122, 122 | 121, 121, 121 | 121, 121, 121 | 0, 0, 0 |
| 1× | warm pan | selector | 180, 180, 180 | 60, 60, 60 | 16.8, 16.8, 16.8 | 122, 122, 122 | 121, 121, 121 | 0, 0, 0 | 0, 0, 0 |
| 1× | warm pan | naive | 180, 180, 180 | 60, 60, 60 | 16.8, 16.8, 16.8 | 122, 121, 122 | 121, 120, 121 | 121, 120, 121 | 0, 0, 0 |
| 1× | scripted cold | selector | 181, 182, 182 | 60, 60, 60 | 16.8, 16.8, 16.8 | 180, 180, 180 | 180, 180, 180 | 0, 0, 0 | 0, 0, 0 |
| 1× | scripted cold | naive | 182, 182, 182 | 60, 60, 60 | 16.8, 16.8, 16.8 | 180, 180, 180 | 180, 180, 180 | 180, 180, 180 | 0, 0, 0 |
| 1× | scripted warm | selector | 182, 182, 182 | 60, 60, 60 | 16.8, 16.8, 16.8 | 180, 180, 180 | 180, 180, 180 | 0, 0, 0 | 0, 0, 0 |
| 1× | scripted warm | naive | 182, 182, 182 | 60, 60, 60 | 16.8, 16.8, 16.8 | 180, 180, 180 | 180, 180, 180 | 180, 180, 180 | 0, 0, 0 |
| 1× | wheel zoom | selector | 100, 96, 115 | 60, 60, 60 | 16.8, 16.8, 16.8 | 87, 85, 96 | not counted | 30, 30, 30 | 0, 0, 0 |
| 1× | wheel zoom | naive | 102, 101, 101 | 59.4, 60, 60 | 33.3, 16.8, 16.8 | 89, 86, 88 | not counted | 30, 30, 30 | 0, 0, 0 |
| 4× | cold pan | selector | 180, 181, 181 | 60, 60, 60 | 16.8, 16.8, 16.8 | 121, 121, 121 | 120, 120, 120 | 0, 0, 0 | 0, 0, 0 |
| 4× | cold pan | naive | 180, 181, 180 | 60, 60, 60 | 16.8, 16.8, 16.8 | 122, 121, 121 | 119, 120, 120 | 119, 120, 120 | 0, 0, 0 |
| 4× | warm pan | selector | 180, 180, 180 | 60, 60, 60 | 16.8, 16.8, 16.8 | 121, 121, 122 | 118, 120, 121 | 0, 0, 0 | 0, 0, 0 |
| 4× | warm pan | naive | 180, 180, 180 | 60, 60, 60 | 16.8, 16.8, 16.8 | 121, 121, 121 | 120, 120, 119 | 120, 120, 119 | 0, 0, 0 |
| 4× | scripted cold | selector | 76, 97, 98 | 24.1, 31.5, 32 | 133.4, 116.8, 116.7 | 75, 96, 97 | 74, 96, 97 | 0, 0, 0 | 0, 0, 0 |
| 4× | scripted cold | naive | 75, 76, 80 | 23.4, 24.1, 25.1 | 133.3, 133.3, 133.4 | 74, 77, 79 | 73, 74, 78 | 73, 74, 78 | 0, 0, 0 |
| 4× | scripted warm | selector | 175, 182, 182 | 57.1, 60, 60 | 66.7, 16.8, 16.8 | 174, 180, 180 | 173, 180, 180 | 0, 0, 0 | 0, 0, 0 |
| 4× | scripted warm | naive | 175, 170, 178 | 57.4, 56, 58.7 | 66.7, 66.6, 49.9 | 173, 168, 176 | 173, 168, 176 | 173, 168, 176 | 0, 0, 0 |
| 4× | wheel zoom | selector | 103, 98, 99 | 58.3, 59.4, 59.4 | 66.7, 33.3, 33.3 | 67, 76, 81 | not counted | 30, 30, 30 | 0, 0, 0 |
| 4× | wheel zoom | naive | 104, 98, 102 | 58.3, 59.4, 48.1 | 66.6, 33.3, 116.6 | 76, 72, 73 | not counted | 30, 30, 30 | 0, 0, 0 |

Pointer delivery during the pans: 360 moves were sent in each pan. The engine received 233 to 241 `pointermove` events at 1× and 141 to 166 at 4×.

Long animation frames: none in any pointer pan and none at 1×. At 4× the scripted cold glide had 20 to 23 per run, the scripted warm glide 0 to 4 and the wheel zoom 0 to 7. Every one of them had a blocking duration of 0 ms.

Other observations:

- The fitted view showed 1.2× and the inspector rendered twice on the way there (mount and fit). After the warm pan the source had read 87 tiles in all, the same as after the cold pan, so the warm pan read none.
- One run (repeat 2, 1×, naive) logged one tile error, `SOI not found`, from the geotiff decode pool. The other eleven runs logged none.
- The page's `requestAnimationFrame` rate stayed at 60 fps during every pointer pan, while deck drew on 121 or 122 of the 180 frames. The camera changed on those frames only.

### Remounting the engine in the browser (VIEW-001)

On the same page at 1×, with CMU-1.svs open, a script unmounted the engine, ran 20 cycles of `mount`, 150 ms of waiting and `unmount`, then mounted once more. After each step it read the listeners on the host element and on its canvas through the DevTools protocol (`DOMDebugger.getEventListeners`).

| After | Host listeners | Canvases | Canvas listeners |
|---|---|---|---|
| first mount | 6 (`pointerdown`, `pointermove`, `pointerup`, `pointercancel`, `pointerleave`, `wheel`) | 1 | 11 |
| unmount | 0 | 0 | 0 |
| 20 remount cycles, unmounted | 0 | 0 | 0 |
| final mount | 6 | 1 | 11 |

The page logged 13 uncaught `TypeError: Failed to fetch` errors during the 20 fast cycles. None appeared in the measurement runs, which never unmount.

## Interpretation

- STACK-006's "Done when" is met for pointer pans. A Viv slide panned at 60 fps, cold and warm, with and without a 4x CPU throttle, while the React inspector showed the zoom level and rendered 0 times, measured with `<Profiler onRender>` in a profiling build.
- The control shows the counter works. Reading the whole camera rendered the inspector once per camera notification, which the engine caps at one per frame: 120 renders in a 3 s pointer pan and 180 in a 3 s scripted glide.
- During the wheel zoom the inspector rendered once per wheel event (30), not once per frame (96 to 115) and not once per deck draw (67 to 96), because its selected value changed only when the zoom did.
- Headless Chrome delivered the 120 Hz input as about 80 events per second at 1× and about 50 at 4×, and the camera changed on about two frames in three. The scripted glide changes the camera on every frame and is the stricter check of the engine path. It held 60 fps at 1× and when warm at 4×.
- Assumption: the 24 to 32 fps of the scripted cold glide at 4× comes from tile loading, not from React or the engine. Both modes drop equally, the warm run of the same glide holds 57 to 60 fps, and the long frames had no blocking script time. The spike's minimal source reads tiles through geotiff without the POC's fixes, so this is not a number for the product viewer.
- The longest frames in the naive warm glide at 4× (50 to 67 ms) were slightly worse than in selector mode. Three repeats are too few to say whether the renders cost those frames.

## Follow-ups

- [ADR 0100](../adr/0100-viewer-hot-path-state-outside-react.md) records the decision.
- TODO: rerun on the versions STACK-015 settles and with the VIEW-004 (decode worker pool) source, and measure the cold glide at 4× again.
- TODO: measure on a 120 Hz display or with a 120 Hz frame rate, which this headless setup does not give.
- TODO: the `Failed to fetch` errors on fast remounts were not investigated. They probably come from tile reads still in flight when the route is destroyed, and VIEW-030 (memory and teardown) should check that a destroyed route cancels its reads quietly. The listener counts cover DOM listeners only, not luma.gl's media query listener from POC doc 24, which VIEW-030's heap test covers.
- TODO: the `SOI not found` tile error was not investigated. STACK-016 (TIFF and Zarr readers) owns the reader.
