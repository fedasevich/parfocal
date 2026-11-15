# Result: deck.gl WebGPU route against the Viv goldens, and route switch memory across two routes

- Date: 2026-11-15
- Backlog: VIEW-037 (deck.gl 9.4 WebGPU route)
- Kind: baseline
- Commit: 8a4d3d45 for the first tables, and the follow-up commit of the same task for the tables marked so
- Environment: 24 GB Mac, Darwin 24.6.0, Playwright headless Chrome (`channel: "chrome"`), WebGL on ANGLE Vulkan SwiftShader, WebGPU on the SwiftShader adapter (`--enable-unsafe-webgpu --use-webgpu-adapter=swiftshader --use-vulkan=swiftshader --enable-features=Vulkan`), one Playwright worker, no network shaping. Other agents ran on the same machine. Each run started when the 1-minute load was under 20 (between 9.3 and 19.6), and the load was not held there during a run.
- Data: `CMU-1.svs` and `CMU-1-Small-Region.svs` from the fixture cache (public test slides, no PHI)

## Question

Does the deck.gl 9.4 WebGPU route draw the same frames as Viv, within the tolerances of the Viv goldens, with zero uncaptured GPU errors? Does switching between Viv and this route keep the heap within 10% of the warmed-up baseline with one live `Deck` and one canvas, as [ADR 0103](../adr/0103-memory-settings-and-test-baseline.md) (memory settings and test baseline) asks? The earlier [Viv to Viv run](2026-11-14-renderer-route-switch-memory.md) measured 5.3% growth.

## Method

`pnpm exec playwright test --workers=1 routes-cmu1 viv-cmu1` in `packages/golden-images` and `pnpm exec playwright test --workers=1 route-switch` in `packages/viewer-engine`. `render/routes-cmu1.spec.ts` renders each scene on the route and compares the canvas screenshot with the golden PNG that Viv produced. Overlay kinds are compared with the `viv-overlay-*` goldens at the overlay tolerance (channel delta 4, 0.1% of pixels, mean error 0.5). The ID label golden comes from the Linux CI runner and fails on this Mac on Viv too, so that kind is compared with a Viv frame drawn in the same browser. The route's `uncapturedGpuErrors()` count and its `onError` messages are asserted in every test. `browser/route-switch.spec.ts` is unchanged in method from the earlier run, except that it now cycles `deck-webgpu`, `viv`, `deck-webgpu` and so on.

## Results

Slide frames on the `deck-webgpu` route, all with 0 uncaptured GPU errors and no reported error:

| Scene | Outcome against the Viv golden |
| --- | --- |
| `viv-cmu-1-svs-fit` | matched |
| `viv-cmu-1-svs-10x` | matched |
| `viv-cmu-1-svs-40x` | matched |
| 10x after Viv, then `deck-webgpu`, then Viv again | matched, same camera |

The three Viv goldens also matched on the Viv route in the browser launched with the WebGPU flags, and `viv-cmu1.spec.ts` passed unchanged in the browser without them.

Overlay kinds on the `deck-webgpu` route in the follow-up commit, all with 0 uncaptured GPU errors:

| Kind | Pixels differing by more than 4 | Largest channel delta | Mean error R, G, B | Reference | Test bound |
| --- | --- | --- | --- | --- | --- |
| coverage | 0.000% | 1 | 0.000, 0.000, 0.000 | Viv golden | 0.1% |
| heatmap | 0.000% | 1 | 0.000, 0.000, 0.000 | Viv golden | 0.1% |
| nuclei | 0.004% | 240 | 0.008, 0.007, 0.004 | Viv golden | 0.1% |
| ai-proposals | 0.625% | 244 | 1.144, 1.144, 1.144 | Viv golden | 2% |
| human-annotations | 0.000% | 1 | 0.000, 0.000, 0.000 | Viv golden | 0.1% |
| measurements | 0.008% | 217 | 0.015, 0.011, 0.014 | Viv golden | 0.1% |
| id-labels | 0.000% | 1 | 0.002, 0.002, 0.002 | Viv frame, same browser | 0.1% |
| comment-pins | 0.000% | 1 | 0.000, 0.000, 0.000 | Viv golden | 0.1% |

Before three fixes the numbers were different. In commit 8a4d3d45 the outlines of nuclei, human annotations and measurements differed in 0.307%, 0.332% and 0.241% of pixels (largest delta 240) and the AI proposals in 0.961%, until the route gave each closed ring a third closing vertex. Dropping the second closing vertex instead made it worse (0.622%, 0.729% and 0.465%). The heatmap differed in 7.178% of pixels (largest delta 24) while luma.gl uploaded the `ImageData` through a 2D canvas on a software adapter. The comment pins differed in 0.743% of pixels (largest delta 88) while their icon atlas had one mip level. With dashes left on, the AI proposals layer failed to compile its WGSL and raised uncaptured errors (`Error while parsing WGSL`, `Invalid RenderPipeline`, `Invalid CommandBuffer`) in every frame.

Route switch memory, 15 switches with a five-switch warm-up, two runs:

| Run | Baseline heap | Last heap | Growth | Decks per round | Canvases per round | Uncaptured GPU errors | Switch time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 8.7 MB | 9.1 MB | 3.9% | 1 | 1 | 0 | 779 to 1141 ms |
| 2 | 8.7 MB | 9.0 MB | 3.5% | 1 | 1 | 0 | 767 to 1072 ms |

Run 2 is the committed code. Run 1 was taken just before the texture upload moved from the deprecated `data` prop of `createTexture` to `writeData`, with nothing else different. After dispose both runs had 0 live decks and 0 canvases. The heap was 8.5 to 9.1 MB after a switch to `deck-webgpu` and 7.9 to 8.4 MB after a switch to Viv.

Pan and budget specs on the route in the follow-up commit (`PARFOCAL_RENDERER_ROUTE=deck-webgpu pnpm exec playwright test --workers=1 pan.spec budgets.spec`, started at load 19.8, which rose to 31.9 during the run). All seven tests passed their existing budgets:

| RTT | Fitted image, fastest of 3 | Sharp after a jump to 10x, fastest of 3 |
| --- | --- | --- |
| 0 ms | 1217 ms, 8 requests | 649 ms, 13 requests |
| 50 ms | 2074 ms, 8 requests | 1061 ms, 13 requests |
| 100 ms | 2851 ms, 8 requests | 1645 ms, 13 requests |
| 200 ms | 4224 ms, 8 requests | 2942 ms, 13 requests |

| Pan run | Open | Outbound | Back | Duplicate bytes | Settle |
| --- | --- | --- | --- | --- | --- |
| six decode workers | 21 fetches | 27 fetches | 0 fetches | 0 B | 337 and 225 ms |
| page, shared bytes | 21 fetches | 27 fetches | 0 fetches | 0 B | 336 and 511 ms |
| page, geotiff direct | 21 fetches | 27 fetches | 0 fetches | 0 B | 806 and 201 ms |

The pan, budget and third switch runs were taken on the follow-up code just before the loop vertex change, which touches overlay outlines only and which these specs do not draw. A third switch run grew the heap 4.1% (8.7 MB to 9.1 MB), with one deck and one canvas each round and none after dispose.

## Interpretation

The route draws slide pixels that the Viv goldens accept, so sharing the ladder, the decode workers and the texture settings gives parity on SwiftShader. Rasters, pins, text labels and polygon outlines also match at the Viv tolerance. The outlines needed a route-side change. The shared builder ends a closed ring with two wrapped vertices, which WebGL draws as a closed loop. deck.gl's WebGPU `PathLayer` reads the same buffer through its tesselator and left one or two short marks on each ring. With a third wrapped vertex the WebGPU frame matches, and the Viv nuclei golden still matched on Viv when the shared builder was switched to three for one run, so the difference lies in how the WebGPU path closes a loop (not traced further in deck.gl). Only the AI proposals stay outside the Viv tolerance, because dashes are drawn solid on this route, and their bound in the test is about three times the measured value. A dash was not built: deck.gl's `PathStyleExtension` injects GLSL only, and dashes as geometry would have to be rebuilt in screen pixels on every zoom step with the same phase and caps as the extension, which was judged out of reach inside the time box.

An earlier switch run grew 72.2% and kept one more `Deck` alive every second round. The cause was the test page, which kept every WebGPU route in an array to read its error count, and the route itself was not changed to fix it.

All of this is SwiftShader on one Mac. No real GPU was measured, so the switch times say nothing about a user's machine, and the luma.gl canvas upload path is only taken on software adapters.

## Dashes in WGSL (VIEW-070, dashed AI proposals on the deck.gl WebGPU route)

Measured later the same day on the same Mac and flags, with `pnpm exec playwright test --workers=1 routes-cmu1 -g ai-proposals` in `packages/golden-images`, five runs with the same numbers. It was not run on the Linux CI runner. The route now swaps deck.gl's `PathStyleExtension` for a subclass that injects the dash as WGSL.

| Kind | Pixels differing by more than 4 | Largest channel delta | Mean error R, G, B | Reference | Test bound | Uncaptured GPU errors |
| --- | --- | --- | --- | --- | --- | --- |
| ai-proposals, dashed in WGSL | 0.085% | 244 | 0.145, 0.145, 0.145 | Viv golden | 0.1% | 0 |

The route reports no error for this kind any more, and the 2% bound is gone from the test. In the diff image every differing pixel lies on one edge of each of the two rings, and all other edges match. A probe of deck.gl's `PathTesselator` shows why. It was a Node script (not kept) that called `updateGeometry` with `normalize: false`, `loop: true` and a synthetic five-point ring in the builder's layout (binary `getPath` of size 2 with `startIndices`), once with `isWebGPU: false` and two wrapped vertices, and once with `isWebGPU: true` and three, and printed `segmentTypes` and `getPathSegmentIndices(0)`. On WebGL the seven vertices give segments 0 to 5 with a start cap and an end cap, so the first edge is drawn twice, at dash phase 0 and at the phase of the whole ring length. On WebGPU the eight vertices give segments 5, 1, 2, 3 and 4, so each edge is drawn once. The remaining difference therefore follows from how the Viv golden was drawn, and it was left there because Viv must not change in this task. It will not shrink on this route alone.

Only one shader variant was compiled and measured on a device: path mode, pixel units, butt caps, not justified and without `antialiasing`, which is what the overlay builder asks for. The segment mode, rounded cap, justified and antialiased branches of the WGSL are ported from deck.gl's GLSL and covered only by a unit test of their text anchors.

## Each dashed ring edge drawn once (VIEW-072, draw the first edge of a dashed ring once on Viv)

Measured later the same day on the same Mac and flags with `PARFOCAL_E2E_PORT=5199 pnpm exec playwright test --workers=1 routes-cmu1` in `packages/golden-images`, one run. It was not run on the Linux CI runner.

The overlay builder now hands a dashed closed ring to deck.gl starting at the middle of its first edge, as M, P1, ..., Pn-1, P0, M, with the same vertex count as before (`startingMidFirstEdge` in `src/overlay/deck/binary-data.ts`). On WebGL deck.gl tesselates a binary ring as an open path, so every edge is now drawn once and every corner keeps its joint, and the two butt ends meet flush at M. The WebGPU route appends P1 and P2 to such a ring, so its closed tesselation draws the same segments in the same order, with dash phase 0 at M on both routes. Solid outlines and every casing keep the old two wrapped vertices and are byte for byte unchanged.

| Kind | Pixels differing by more than 4 | Largest channel delta | Mean error R, G, B | Reference | Test bound | Uncaptured GPU errors |
| --- | --- | --- | --- | --- | --- | --- |
| ai-proposals, ring from mid first edge | 0.000% | 1 | 0.000, 0.000, 0.000 | regenerated Viv golden | 0.1% | 0 |

All other kinds on the route gave the numbers in the first overlay table. Moving the dash origin from P0 to M shifts the whole pattern along each ring, so every golden with dashed rings moved and was regenerated. Against the new code the old goldens differed in these fractions of pixels: AI proposals 0.896%, the mark unsure outline mode (`viv-outline-mark-unsure.png`) 0.366%, the agreement views AI against reviewed 0.799%, model against model 0.493% and reviewer against reviewer 1.252% (`overlay-agreement-*.png`), and the dimmed objects below the cutoff (`overlay-draw-cutoff-dimmed.png`) 1.090%. The engine's `overlay-agreement.spec.ts` and `overlay-draw-style.spec.ts` passed whole on the old code, so these moves come from this change. All other tests of `viv-overlays.spec.ts`, `viv-outline-modes.spec.ts`, `overlay-agreement.spec.ts` and `overlay-draw-style.spec.ts` matched without an update, except two that fail on this Mac with or without the change: the ID labels golden (1.790%) and the stack of all eight layers (1.751% before the change, 2.545% after). The stack also holds the AI proposals, so it needs regenerating once the label difference is understood. TODO: find why `viv-overlay-id-labels.png` no longer matches on this Mac, then regenerate `viv-overlay-stack.png`.

## Follow-ups

[ADR 0314](../adr/0314-deck-webgpu-route-mirrors-the-viv-tile-pipeline.md) (the deck.gl WebGPU route mirrors the Viv tile pipeline and owns its tile textures). Dashed outlines were built in VIEW-070 (section above). The first edge of a dashed ring drawn twice on Viv was fixed in VIEW-072 (section above). Solid outlines on Viv still draw their first edge twice, which only shows with translucent outlines. TODO: a run on a real GPU, headed. TODO: check translucent outlines on this route, since the third closing vertex draws one edge of each ring more than once.
