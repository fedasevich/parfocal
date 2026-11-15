# Result: the deck.gl WebGPU route on the Mac's real GPU, and translucent outlines on both routes

- Date: 2026-11-15
- Backlog: VIEW-071 (pick the renderer route per slide, checked on a real GPU)
- Kind: baseline
- Commit: the VIEW-071 commit that adds this file
- Environment: MacBook with an Apple M4, macOS Darwin 24.6.0, Google Chrome through Playwright 1.64 (`channel: "chrome"`). Real-GPU runs were headed with `PARFOCAL_GPU=hardware` (`--enable-unsafe-webgpu --ignore-gpu-blocklist --enable-gpu-rasterization --force-color-profile=srgb` and the occlusion and throttling flags of `bench:frames`), and each test checked that WebGL did not run on SwiftShader. SwiftShader runs used the flags of the earlier [route result](2026-11-15-deck-webgpu-route-goldens-and-switch-memory.md). Other agents shared the machine and nothing kept it quiet: the 1-minute load was 42.8 at the start and 49.7 at the end of the golden run, and 62.9 at the start and 90.6 at the end of the pan and budget run. Each run was done once.
- Data: `CMU-1.svs`, `CMU-1-JP2K-33005.svs` and `CMU-1.tiff` from the fixture cache, and the fake-API slide `tumor_044` in the app (public test slides, no PHI)

## Question

Does the deck.gl WebGPU route draw the same frames as Viv on a real GPU, and do the pan and budget specs pass on it there? Do translucent outlines match between the routes, given that each closes a ring differently?

## Method

`PARFOCAL_GPU=hardware pnpm exec playwright test --workers=1 routes-cmu1` in `packages/golden-images`. On a real GPU the spec only reports: it compares each frame with the SwiftShader golden and with the Viv frame drawn in the same browser, and asserts no reported error and zero uncaptured GPU errors. The three slide scenes were run a second time after a fix to the spec, which had looked for a golden under a wrong name for the Viv control. `PARFOCAL_GPU=hardware PARFOCAL_RENDERER_ROUTE=deck-webgpu pnpm exec playwright test --workers=1 pan.spec budgets.spec` in `packages/viewer-engine`, with the existing budgets asserted. No Viv control run of the pan and budget specs was made on the real GPU. `PARFOCAL_GPU=hardware pnpm exec playwright test --workers=1 renderer-route` in `apps/web` switches an open slide through the developer setting. The translucent outline golden `viv-overlay-translucent-outlines` is nuclei and human annotations at layer opacity 0.5, drawn by Viv on SwiftShader.

## Results

Slide frames on the real GPU, 0 uncaptured GPU errors:

| Scene | Viv against the SwiftShader golden | deck-webgpu against Viv, same browser |
| --- | --- | --- |
| `viv-cmu-1-svs-fit` | 6.899% differ, largest delta 113 | 0.009% differ, largest delta 12 |
| `viv-cmu-1-svs-10x` | 13.401% differ, largest delta 76 | 0.000% differ, largest delta 1 |
| `viv-cmu-1-svs-40x` | 42.985% differ, largest delta 109 | 0.000% differ, largest delta 0 |
| 10x after switching to deck-webgpu and back | 13.401% differ | 0.000% differ from a plain Viv frame |

Overlay kinds on the real GPU, the deck-webgpu frame against the Viv frame of the same browser, 0 uncaptured GPU errors:

| Kind | Pixels differing by more than 4 | Largest channel delta |
| --- | --- | --- |
| coverage | 0.000% | 1 |
| heatmap | 0.000% | 1 |
| nuclei | 0.002% | 60 |
| ai-proposals | 0.097% | 244 |
| human-annotations | 0.000% | 1 |
| measurements | 0.000% | 1 |
| id-labels | 0.000% | 1 |
| comment-pins | 0.000% | 1 |
| translucent outlines | 0.856% | 47 |

Every Viv overlay frame differed from its SwiftShader golden by 6.5% to 29.7% of pixels on the real GPU, and the route's frame differed from that golden by the same amount within 0.05 points, except for the translucent outlines and the AI proposals.

Translucent outlines on SwiftShader against the new golden: Viv 0.000%, deck-webgpu 0.743% (892 of 120,000 pixels, largest delta 165, 0.232 mean error in red). In the diff image every differing pixel lies on one edge of each ring. On 481 of them the golden is darker and on 411 the route is darker.

Pan and budget specs on the deck-webgpu route on the real GPU, all 15 tests passed their existing budgets:

| Slide | RTT | Fitted image, fastest of 3 | Sharp after a jump to 10x, fastest of 3 |
| --- | --- | --- | --- |
| CMU-1.svs | 0 ms | 965 ms, 8 requests | 645 ms, 13 requests |
| CMU-1.svs | 50 ms | 1536 ms | 1012 ms |
| CMU-1.svs | 100 ms | 2237 ms | 1648 ms |
| CMU-1.svs | 200 ms | 3774 ms | 2930 ms |
| CMU-1-JP2K-33005.svs | 0 ms | 842 ms, 4 requests | 462 ms, 7 requests |
| CMU-1-JP2K-33005.svs | 200 ms | 3653 ms | 1732 ms |
| CMU-1.tiff | 0 ms | 658 ms, 7 requests | 386 ms, 4 requests |
| CMU-1.tiff | 200 ms | 3698 ms | 1112 ms |

| Pan run | Open | Outbound | Back | Duplicate bytes | Settle |
| --- | --- | --- | --- | --- | --- |
| six decode workers | 21 fetches | 26 fetches | 1 fetch | 0 B | 1615 and 32 ms |
| page, shared bytes | 21 fetches | 27 fetches | 0 fetches | 0 B | 936 and 32 ms |
| page, geotiff direct | 21 fetches | 27 fetches | 0 fetches | 0 B | 833 and 32 ms |

In the app on the real GPU, the developer setting switched an open `tumor_044` from Viv to deck-webgpu and back with the camera unchanged and one canvas each time, and a slide opened with the setting on opened on deck-webgpu. Both tests passed.

## Interpretation

On a real GPU the route draws the slide pixels Viv draws, so the parity seen on SwiftShader holds. The SwiftShader goldens do not describe a real GPU: Viv itself misses them by up to 43% of pixels, so on a real GPU only the comparison with Viv in the same browser means anything, and the spec reports instead of asserting there. The AI proposals keep the one-edge difference of VIEW-070 (dashed AI proposals on the deck.gl WebGPU route). The pan and budget numbers were taken at a load of 63 to 91 and say only that the route stays within the budgets on this Mac, not what it costs on a quiet machine.

Translucent outlines do not match. The difference sits on one edge per ring, where the two routes close the ring differently, and with the mixed sign it is not a plain extra coat on one route. The route test is marked `test.fail` on SwiftShader, so CI stays green and fails when the frames start to match, which is when the marker has to go. The shared builder and both goldens were left alone, because VIEW-072 (closing dashed rings in the shared overlay builder) is changing how rings close.

In the app on SwiftShader the switch never finished: a second `navigator.gpu.requestAdapter()` call in the page did not resolve within 20 s, while the first did. In the golden harness two calls resolve. The cause was not traced, and the app spec runs only with `PARFOCAL_GPU=hardware`.

## Follow-ups

TODO: remove the `test.fail` marker of the translucent outline test on deck-webgpu after VIEW-072, and regenerate the translucent golden if that change moves Viv's ring closing. TODO: a Viv control run of the pan and budget specs on the real GPU at a low load. TODO: find why a second adapter request hangs in the app on SwiftShader, so that the app spec can run in CI.
