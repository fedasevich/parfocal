# Result: ID labels, translucent outlines and a lost device on the custom WebGPU route

- Date: 2026-11-15
- Backlog: VIEW-073 (finish the custom WebGPU route)
- Kind: check
- Commit: fec60325 (ID labels and the buffer size guard), d5008d90 (translucent outlines), and the device loss commit of the same task
- Environment: 24 GB Mac, Darwin 24.6.0, Playwright headless Chrome (`channel: "chrome"`), WebGL on ANGLE Vulkan SwiftShader, WebGPU on the SwiftShader adapter, one Playwright worker. Other agents ran on the same machine and the load was not read. Nothing was run on a real GPU or on the Linux CI runner.
- Data: `CMU-1.svs` from the fixture cache (public test slide, no PHI)

## Question

Do the ID labels and the translucent outlines on the custom WebGPU route match Viv within the overlay tolerance (channel delta 4, 0.1% of pixels, mean error 0.5)? Does the route redraw the same frame after its device is lost?

## Method

`PARFOCAL_E2E_PORT=5214 pnpm exec playwright test --workers=1 routes-cmu1 -g "on the custom-webgpu"` in `packages/golden-images`, and the same command with `-g "a lost device on the custom-webgpu"`. ID labels are compared with the Viv frame of the same browser, as on the deck.gl WebGPU route, because glyphs depend on the platform font. Translucent outlines (nuclei and human annotations at opacity 0.5) are compared with the golden image that Viv drew. Each row is one run.

## Results

ID labels on the `custom-webgpu` route, three runs with the same numbers:

| Kind | Pixels differing by more than 4 | Largest channel delta | Mean error R, G, B | Reference | Outcome |
| --- | --- | --- | --- | --- | --- |
| id-labels | 0.000% | 1 | 0.002, 0.002, 0.002 | Viv frame, same browser | passed |

Translucent outlines against `viv-overlay-translucent-outlines`:

| Route and state | Pixels differing by more than 4 | Largest channel delta R, G, B | Mean error R, G, B | Outcome |
| --- | --- | --- | --- | --- |
| Viv | 0.000% | 0, 0, 0 | 0.000, 0.000, 0.000 | passed |
| deck.gl WebGPU | 0.000% | 1, 1, 1 | 0.000, 0.000, 0.000 | passed |
| custom WebGPU before this task | 1.297% | 185, 170, 185 | 0.408, 0.302, 0.315 | failed |
| custom WebGPU, a pixel takes each ring once | 0.795% | 174, 166, 176 | 0.291, 0.207, 0.217 | failed |
| the same, with the first edge of a closed ring drawn twice | 0.112% | 174, 166, 209 | 0.078, 0.064, 0.066 | failed |
| the same, with a cap at the end of the repeated edge and partly covered dash pixels not blocking later ones (committed) | 0.063% | 174, 166, 209 | 0.067, 0.054, 0.055 | passed |

The other overlay kinds after both changes, one run of all twelve custom WebGPU tests, all passed with 0 uncaptured GPU errors: coverage 0.000%, heatmap 0.000%, nuclei 0.049%, ai-proposals 0.078%, human-annotations 0.008%, measurements 0.009%, comment-pins 0.000%. These are the numbers of the [VIEW-038 result](2026-11-15-custom-webgpu-route-goldens-switch-memory-and-budgets.md) (custom WebGPU engine route), so the opaque path did not change. The three slide goldens matched.

Device loss, one run: the test draws heatmap, nuclei, ID labels and comment pins, destroys the device in the render worker twice, and after each loss the route reported 1 and then 2 recoveries, no error, 0 uncaptured GPU errors, the same layer list, and a frame within the overlay tolerance of the frame before the loss. The test took 33.8 s.

`node --test test/custom-webgpu/*.test.ts` passes 15 tests. They cover the glyph packing and label instances on a fake font, the ring id and the repeated first edge in the segment instances, and a set above the buffer limit being left out without a new buffer.

## Interpretation

ID labels now match Viv to a channel delta of 1, so all eight overlay kinds pass on this route. The Viv golden for translucent outlines shows the first edge of every closed ring blended twice, which is how deck.gl's path layer draws a loop, and the route has to repeat that edge to match. With that, the remaining 0.063% is close to the sum of the opaque differences of the two kinds (0.049% and 0.008%), which are single pixels on line edges.

The loss test destroys the device on purpose. A loss that the browser causes was not produced, and neither was the fourth loss within 30 seconds, after which the route fails as before.

Nothing here was measured on a real GPU. Compute culling, the level of detail tiers and the timing of 1.6M nuclei against the VIEW-029 budget are not built or measured.

## Follow-ups

TODO: the level of detail tiers and culling on this route, with a GPU timing on the Mac. The existing `gpu-bench` harness reads WebGL timer queries from the Viv route, so this route needs a `timestamp-query` reading in the render worker first.
