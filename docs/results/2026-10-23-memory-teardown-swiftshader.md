# Result: on SwiftShader, 20 slide switches keep one Deck and the heap 3.9% to 4.0% over baseline, and without canvasContext.destroy every deck stays alive

- Date: 2026-10-23
- Backlog: VIEW-030 (memory and teardown correctness), closing the heap part of VIEW-001 (engine package API) and the SwiftShader TODO of STACK-015 (Viv and deck.gl versions)
- Kind: baseline
- Commit: 8d68193 plus the uncommitted VIEW-030 changes in `packages/viewer-engine` (the memory test, the harness and `src/viv`)
- Environment: MacBook with Apple M4 (10 cores, 24 GB), macOS 15.8.1, Node 26.9.0, pnpm 12.9.1, Google Chrome 155.0.8059.86 driven headless by `@playwright/test` 1.64.0 with `channel: "chrome"` and `--use-angle=swiftshader --enable-unsafe-swiftshader --enable-blink-features=ForceEagerMeasureMemory`. WebGL2 reported `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)`. Viewport 1280 × 720 CSS pixels at a device pixel ratio of 1. The page was cross-origin isolated. Localhost, no network shaping. Viv 0.23.0, deck.gl 9.4.0, luma.gl 9.4.2, geotiff 3.0.5
- Data: `CMU-1-Small-Region.svs` from the `small` fixture group, which CI fetches, and the committed `synthetic-jpeg.tiff`, `synthetic-zlib.ome.tiff`, `synthetic-big-endian.tiff` and `synthetic-sparse.tiff`. No PHI

## Question

Does the VIEW-030 Done-when line hold on SwiftShader, the renderer of the hosted Linux runner ([ADR 0011](../adr/0011-hosted-ci-only.md), [ADR 0101](../adr/0101-golden-image-comparison.md)): a memory test opens 20 slides in sequence and the heap returns to within 10% of baseline with exactly one Deck alive? Does the test still fail without the `canvasContext.destroy()` step of [ADR 0098](../adr/0098-viv-and-deck-gl-versions.md)? The [STACK-015 spike](2026-10-23-viv-version-spike.md) answered both on a real GPU only, with a heap 3.7% to 4.4% over baseline and seven times larger without the step.

## Method

The test is `packages/viewer-engine/browser/memory.spec.ts`, run with `pnpm --filter @parfocal/viewer-engine test:browser` or as part of `pnpm test:browser`, which the `browser` CI job runs.

1. Playwright's global setup (`browser/global-setup.ts`) builds `browser/page` with Vite 8.3.3 and serves the build, the fixture cache and the synthetic folder from one local server with COOP `same-origin` and COEP `require-corp`.
2. `browser/page/memory-harness.ts` mounts the VIEW-001 engine (`createViewerEngine`) on a full-window container. Its renderer route (`browser/page/memory-route.ts`) is a minimal test route that VIEW-002 (Viv route on WebGL2 for RGB brightfield) replaces. It creates one `Deck` per slide on its own canvas with `deckDeviceProps` (MSAA off), an `OrthographicView`, `useDevicePixels: 1` and one `MultiscaleImageLayer` with `pickable: false` and a selections array from `stableSelections`. The engine's camera is the deck's view state. The slide opener reads the slide through the VIEW-003 PixelSource registry, and `browser/page/viv-levels.ts` presents it to Viv as a power-of-two ladder of 256 px interleaved RGB tiles.
3. Every visit opens the slide through `engine.openSlide`, waits until the layer reports loaded for three frames in a row, then zooms in two steps, goes to full resolution and fits again, waiting for each view to load. A wait over 15 s counts as a timeout.
4. A run opens the five slides in the order above, then the same cycle again until 26 slides have been opened: five warm-up visits, the baseline visit (visit 5, `CMU-1-Small-Region.svs`) and 20 switches, so visit 25 opens `CMU-1-Small-Region.svs` again. After each visit the spec calls `HeapProfiler.collectGarbage` twice and records `Runtime.getHeapUsage` used size, `performance.measureUserAgentSpecificMemory()` (UASM) bytes and the live `Deck`, luma.gl `WebGLDevice` and `CanvasContext` objects counted with `Runtime.queryObjects` on each prototype. The device and canvas context prototypes come from the first device in `onDeviceInitialized`.
5. It then calls `engine.dispose()`, counts once at once, and polls the counts every 25 ms for up to 5 s until no `Deck` is alive.
6. The release step has three modes picked by `?release=`. `wrapper` is `disposeDeck` from `src/viv/dispose-deck.ts`. `no-canvas-context` does the same without `canvasContext.destroy()` (the spike's `lose` mode). `stock` only finalizes and removes the canvas. The test runs `wrapper` and asserts the Done-when line, then runs `no-canvas-context` as the canary that ADR 0098 asks for.
7. To show that the wrapper test itself can fail, `device.canvasContext?.destroy()` in `disposeDeck` was replaced by a no-op for one run and then restored.
8. `browser/settings.spec.ts` checks the other settings on the same build: a two-channel uint8 `XRLayer` drawn with and without `installUint8TextureUpload`, compared per channel after an empty-frame check (golden-images harness), the context attributes of the deck, and a deck disposed before its device exists.
9. `MEMORY_SNAPSHOTS=0,5,20` writes heap snapshots after those visits into `test-results/memory-reports`, which is how the growth in the first cycle was attributed.

Four full runs of both tests were made on the final code. The tables show runs 2 to 4, whose JSON reports were kept. Run 1 printed the same numbers to the console.

## Results

### The wrapper run against the Done-when line

Heap is `Runtime.getHeapUsage` in MB, UASM in MB. "First" is visit 0, "baseline" is visit 5 after the warm-up cycle, "last" is visit 25.

| Run | Release | Heap empty page | Heap first | Heap baseline | Heap last | Growth from baseline | Growth from first | UASM baseline | UASM last | Most Decks alive | Decks right after dispose | Decks after polling | Devices, contexts after dispose | Heap closed | UASM closed | Contexts created / lost | Load timeouts | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | wrapper | 3.4 | 7.58 | 8.22 | 8.54 | 3.9% | 12.7% | 32.9 | 33.2 | 1 | 1 | 0 after 186 ms | 0, 0 | 6.6 | 16.0 | 26 / 26 | 0 | pass |
| 3 | wrapper | 3.4 | 7.58 | 8.21 | 8.54 | 4.0% | 12.7% | 32.9 | 33.2 | 1 | 0 | 0 | 0, 0 | 6.6 | 16.0 | 26 / 26 | 0 | pass |
| 4 | wrapper | 3.4 | 7.58 | 8.21 | 8.54 | 4.0% | 12.7% | 32.9 | 33.2 | 1 | 0 | 0 | 0, 0 | 6.6 | 16.0 | 26 / 26 | 0 | pass |
| 2 | no-canvas-context | 3.4 | 7.58 | 12.40 | 29.43 | 137.5% | 288.1% | 74.9 | 243.5 | 26 | 26 | 26 after 5,262 ms | 26, 26 | 29.4 | 243.4 | 26 / 26 | 0 | canary holds |
| 3 | no-canvas-context | 3.4 | 7.58 | 12.39 | 29.43 | 137.5% | 288.2% | 74.9 | 243.5 | 26 | 26 | 26 after 5,248 ms | 26, 26 | 29.4 | 243.4 | 26 / 26 | 0 | canary holds |
| 4 | no-canvas-context | 3.4 | 7.59 | 12.39 | 29.43 | 137.5% | 288.0% | 74.9 | 243.5 | 26 | 26 | 26 after 5,199 ms | 26, 26 | 29.4 | 243.4 | 26 / 26 | 0 | canary holds |

With `canvasContext.destroy()` removed from `disposeDeck`, the wrapper test failed: 26 decks alive after visit 25, 26 after closing, heap 29.4 MB at visit 25 and 137.6% over baseline.

Every visit of run 4:

| Visit | Slide | Wrapper heap | Wrapper UASM | Wrapper Decks | Canary heap | Canary UASM | Canary Decks | Wrapper open ms |
|---|---|---|---|---|---|---|---|---|
| 0 | CMU-1-Small-Region.svs | 7.58 | 32.2 | 1 | 7.59 | 32.2 | 1 | 1,856 |
| 1 | synthetic-jpeg.tiff | 6.75 | 21.8 | 1 | 8.38 | 38.7 | 2 | 224 |
| 2 | synthetic-zlib.ome.tiff | 7.04 | 22.1 | 1 | 9.30 | 45.3 | 3 | 209 |
| 3 | synthetic-big-endian.tiff | 7.12 | 22.2 | 1 | 10.01 | 51.6 | 4 | 217 |
| 4 | synthetic-sparse.tiff | 7.16 | 22.2 | 1 | 10.72 | 58.0 | 5 | 81 |
| 5 | CMU-1-Small-Region.svs | 8.21 | 32.9 | 1 | 12.39 | 74.9 | 6 | 983 |
| 6 | synthetic-jpeg.tiff | 7.21 | 22.3 | 1 | 13.02 | 81.2 | 7 | 218 |
| 7 | synthetic-zlib.ome.tiff | 7.20 | 22.2 | 1 | 13.67 | 87.5 | 8 | 205 |
| 8 | synthetic-big-endian.tiff | 7.45 | 22.5 | 1 | 14.53 | 94.0 | 9 | 216 |
| 9 | synthetic-sparse.tiff | 7.47 | 22.5 | 1 | 15.20 | 100.4 | 10 | 80 |
| 10 | CMU-1-Small-Region.svs | 8.50 | 33.2 | 1 | 16.87 | 117.3 | 11 | 979 |
| 11 | synthetic-jpeg.tiff | 7.48 | 22.5 | 1 | 17.48 | 123.6 | 12 | 226 |
| 12 | synthetic-zlib.ome.tiff | 7.48 | 22.5 | 1 | 18.10 | 129.8 | 13 | 204 |
| 13 | synthetic-big-endian.tiff | 7.50 | 22.6 | 1 | 18.76 | 136.1 | 14 | 216 |
| 14 | synthetic-sparse.tiff | 7.49 | 22.6 | 1 | 19.39 | 142.4 | 15 | 75 |
| 15 | CMU-1-Small-Region.svs | 8.52 | 33.2 | 1 | 21.04 | 159.3 | 16 | 994 |
| 16 | synthetic-jpeg.tiff | 7.49 | 22.6 | 1 | 21.66 | 165.6 | 17 | 227 |
| 17 | synthetic-zlib.ome.tiff | 7.49 | 22.5 | 1 | 22.29 | 171.9 | 18 | 209 |
| 18 | synthetic-big-endian.tiff | 7.50 | 22.6 | 1 | 22.92 | 178.2 | 19 | 212 |
| 19 | synthetic-sparse.tiff | 7.48 | 22.5 | 1 | 23.57 | 184.5 | 20 | 80 |
| 20 | CMU-1-Small-Region.svs | 8.52 | 33.2 | 1 | 25.23 | 201.4 | 21 | 982 |
| 21 | synthetic-jpeg.tiff | 7.49 | 22.6 | 1 | 25.84 | 207.7 | 22 | 223 |
| 22 | synthetic-zlib.ome.tiff | 7.50 | 22.5 | 1 | 26.48 | 213.9 | 23 | 205 |
| 23 | synthetic-big-endian.tiff | 7.53 | 22.6 | 1 | 27.14 | 220.3 | 24 | 216 |
| 24 | synthetic-sparse.tiff | 7.52 | 22.6 | 1 | 27.78 | 226.6 | 25 | 83 |
| 25 | CMU-1-Small-Region.svs | 8.54 | 33.2 | 1 | 29.43 | 243.5 | 26 | 983 |

In every visit of every run the live `WebGLDevice` and `CanvasContext` counts equalled the live `Deck` count, and the container held one canvas.

### Where the first-cycle growth goes

Heap snapshots of a wrapper run, by V8 node type, visit 20 against visit 0 and against visit 5. This run used the same harness and slides before the warm-up cycle and the release polling were added to the spec, so its visit 20 is the 21st open:

| Compared | Total self size change | `code` | Next largest |
|---|---|---|---|
| visit 0 to visit 20 | +1,094,791 bytes | +895,924 bytes, 4,809 more nodes | ExternalStringData +47,521, WeakArrayList +24,284 |
| visit 5 to visit 20 | +364,016 bytes | +312,568 bytes, 1,951 more nodes | `ScriptTimingInfo`, `PerformanceLongAnimationFrameTiming` and `PerformanceScriptTiming` entries, about 31,000 bytes together |

No `Deck`, layer, texture, `ArrayBuffer` or tile class appears among the 30 largest increases.

### The other settings

| Check | Result |
|---|---|
| Texture formats for a uint8 `XRLayer`, nearest | Viv: `r8uint` per channel. With `installUint8TextureUpload`: `r8unorm` |
| Texture formats for a uint8 `XRLayer`, linear | Viv: `r32float` per channel (a Float32 copy). With `installUint8TextureUpload`: `r8unorm` |
| r8unorm frame against Viv's frame, nearest | largest difference 0, 1 and 0 levels in R, G and B, mean 0, 0.068 and 0, 0 pixels past 1 level |
| r8unorm frame against Viv's frame, linear | largest difference 1, 1 and 1 levels, mean 0.045, 0.008 and 0.045, 0 pixels past 1 level |
| Deck context attributes | `antialias: false`, `SAMPLES` 0 |
| Deck disposed before its device existed, with `disposeDeck` | 0 decks and 0 canvas contexts alive 500 ms later |
| The same with `finalize()` and `remove()` only | 1 deck and 1 canvas context alive |

Test time on this machine: the memory spec about 21 s for the wrapper run and 28 s for the canary, the settings spec about 10 s.

## Interpretation

- The Done-when line holds on SwiftShader with the warm-up cycle: exactly one `Deck` after every one of the 26 visits, none after dispose, and the heap at the 20th switch 3.9% to 4.0% over the baseline. That is within the STACK-015 spike's 3.7% to 4.4% on Metal. The heaps are smaller here (8.2 MB against 13.5 MB) because the slides are smaller than CMU-1.svs, so the two runs agree in shape, not in absolute numbers.
- Measured from the very first open instead, the heap is 12.6% to 12.7% higher at the end, which would fail a 10% budget. The snapshots put 82% of the growth from visit 0 to visit 20 in V8 compiled code, which grows while the five readers, codecs and Viv paths are first optimized and then levels off from visit 10. The baseline is taken after one pass through every slide so that compiled code is not counted as a leak. Assumption: this code growth is bounded. The flat heap from visit 10 to visit 25 (8.50 to 8.54 MB at the `CMU-1-Small-Region.svs` visits) supports it.
- The canary still fails as ADR 0098 expects: without `canvasContext.destroy()` every finalized deck stays alive with its device and canvas context, about 0.87 MB of heap and 8.5 MB of UASM per switch on average, and closing the viewer frees none of it. The leak is still upstream in deck.gl 9.4.0 and luma.gl 9.4.2, so the wrapper stays.
- In some runs one `Deck` was still reachable at the first count after dispose, while its device and canvas context were already gone, and was gone by the next count. Assumption: a callback that was already queued when the deck was finalized holds it for one more task. The test polls for this rather than counting once.
- A deck disposed before its asynchronous device exists would otherwise keep its canvas context and observer alive, because `Deck.finalize()` cannot reach a device that does not exist yet. `disposeDeck` waits for the pending device and releases it when it arrives.
- The r8unorm upload draws within 1 level of Viv's own textures in both filter modes and stores one byte per texel where Viv stores four in its `r32float` copy for linear filtering. That ratio follows from the formats and was not measured. The texture memory itself was not measured, because SwiftShader reports no GPU memory.

## Follow-ups

- [ADR 0103](../adr/0103-memory-settings-and-test-baseline.md) records where the memory settings live, how the r8unorm upload is applied and why the memory test takes its baseline after a warm-up cycle. Status Proposed.
- VIEW-002 (Viv route on WebGL2 for RGB brightfield) replaces the harness route and should import `disposeDeck`, `deckDeviceProps`, `unpickableLayerProps`, `stableSelections` and, for multichannel slides, `installUint8TextureUpload`.
- TODO: confirm on the first hosted CI run that the `browser` job passes with the `small` fixture group, and add its numbers as a new result file.
- Precomputed polygon indices were built with the overlay layers in VIEW-026 (overlay layer system), see [ADR 0108](../adr/0108-overlay-layers-as-typed-data-over-deck-gl.md).
- TODO: the same test on CMU-1.svs, which only the `formats` group has. `viv-levels.ts` is written to serve its 4× levels by reading the finer level and taking every second pixel, which is untested.
- TODO: measure GPU texture memory for the r8unorm upload on a real GPU with luma.gl's memory counter, as doc 24 did.
