# Result: deck.gl WebGPU route against the Viv goldens, and route switch memory across two routes

- Date: 2026-11-15
- Backlog: VIEW-037 (deck.gl 9.4 WebGPU route)
- Kind: baseline
- Commit: 8a4d3d45
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

Overlay kinds on the `deck-webgpu` route, all with 0 uncaptured GPU errors:

| Kind | Pixels differing by more than 4 | Largest channel delta | Mean error R, G, B | Reference | Test bound |
| --- | --- | --- | --- | --- | --- |
| coverage | 0.000% | 1 | 0.000, 0.000, 0.000 | Viv golden | 0.1% |
| heatmap | 0.000% | 1 | 0.000, 0.000, 0.000 | Viv golden | 0.1% |
| nuclei | 0.307% | 240 | 0.350, 0.312, 0.350 | Viv golden | 1% |
| ai-proposals | 0.961% | 244 | 1.542, 1.547, 1.544 | Viv golden | 2% |
| human-annotations | 0.332% | 240 | 0.391, 0.304, 0.371 | Viv golden | 1% |
| measurements | 0.241% | 238 | 0.289, 0.292, 0.290 | Viv golden | 1% |
| id-labels | 0.000% | 1 | 0.002, 0.002, 0.002 | Viv frame, same browser | 0.1% |
| comment-pins | 0.000% | 1 | 0.000, 0.000, 0.000 | Viv golden | 0.1% |

Before two fixes the numbers were different. The heatmap differed in 7.178% of pixels (largest delta 24) while luma.gl uploaded the `ImageData` through a 2D canvas on a software adapter. The comment pins differed in 0.743% of pixels (largest delta 88) while their icon atlas had one mip level. With dashes left on, the AI proposals layer failed to compile its WGSL and raised uncaptured errors (`Error while parsing WGSL`, `Invalid RenderPipeline`, `Invalid CommandBuffer`) in every frame.

Route switch memory, 15 switches with a five-switch warm-up, two runs:

| Run | Baseline heap | Last heap | Growth | Decks per round | Canvases per round | Uncaptured GPU errors | Switch time |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 8.7 MB | 9.1 MB | 3.9% | 1 | 1 | 0 | 779 to 1141 ms |
| 2 | 8.7 MB | 9.0 MB | 3.5% | 1 | 1 | 0 | 767 to 1072 ms |

Run 2 is the committed code. Run 1 was taken just before the texture upload moved from the deprecated `data` prop of `createTexture` to `writeData`, with nothing else different. After dispose both runs had 0 live decks and 0 canvases. The heap was 8.5 to 9.1 MB after a switch to `deck-webgpu` and 7.9 to 8.4 MB after a switch to Viv.

## Interpretation

The route draws slide pixels that the Viv goldens accept, so sharing the ladder, the decode workers and the texture settings gives parity on SwiftShader. Rasters, pins and text labels also match. Outlines do not match exactly. The diff for nuclei shows one or two short marks on each ring, where the closed path joins, and no other difference, which points at how deck.gl's WebGPU `PathLayer` closes a loop (assumption, not traced in deck.gl). The AI proposals difference is larger because dashes are drawn solid on this route. The bounds in the test are about twice to three times the measured values.

An earlier switch run grew 72.2% and kept one more `Deck` alive every second round. The cause was the test page, which kept every WebGPU route in an array to read its error count, and the route itself was not changed to fix it.

All of this is SwiftShader on one Mac. No real GPU was measured, so the switch times say nothing about a user's machine, and the luma.gl canvas upload path is only taken on software adapters.

## Follow-ups

[ADR XXXX](../adr/XXXX-deck-webgpu-route-mirrors-the-viv-tile-pipeline.md) (the deck.gl WebGPU route mirrors the Viv tile pipeline and owns its tile textures). TODO: dashed outlines on this route need either a WGSL dash in deck.gl's `PathStyleExtension` or dashes built as geometry. TODO: trace the loop join difference in the WebGPU `PathLayer`. TODO: a run on a real GPU, headed.
