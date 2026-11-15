# XXXX. The custom WebGPU route ports deck.gl's glyph atlas, blends a ring once with a depth id and rebuilds itself after a lost device

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-073 (finish the custom WebGPU route). Follows VIEW-038 (custom WebGPU engine route).

## Context

[ADR 0326](0326-custom-webgpu-route-draws-from-a-render-worker.md) (the custom WebGPU route draws from a render worker and keeps the Viv tile data path) left four things unbuilt that this change closes: ID labels, translucent outlines that blended twice at round caps, a guard for a set larger than the device's buffer limit, and recovery after a lost device. Every route is compared with frames that Viv drew, so each choice below is the one that reproduces Viv.

## Options considered

ID labels:

1. A signed distance font drawn in the worker. It is sharp at every size, but it cannot match the glyph pixels of deck.gl's text layer, which the Viv route uses without a distance field.
2. Port deck.gl's atlas recipe and box maths. The main thread draws the same 96 characters with the same canvas calls and the worker samples them through the mip chain the comment pins already use.

Translucent outlines:

1. Draw each translucent set into its own texture at full opacity and composite it once. This also removes the darker spot where two different shapes cross, which Viv keeps.
2. Mitred triangles as deck.gl builds them, with no overlap inside a path. It is the exact geometry, and a rewrite of the segment drawing.
3. Keep the segment instances and let a depth attachment hold a ring id, so that a pixel takes each ring once.

A lost device:

1. Fail and ask the user to switch routes, as before.
2. A new worker and a new canvas for every loss.
3. The same worker asks for a new device and configures the same canvas, and the route sends every resource again.

## Decision

ID labels take option 2. `label-glyphs.ts` draws `600 64px monospace` into a 1024 pixel wide canvas with a 4 pixel buffer, in deck.gl's packing order and with its fallback metrics, and places glyphs and boxes with the text layer's formulas. The box and the glyphs are two instanced draws.

Translucent outlines take option 3. A set whose opacity is below 1 draws its casing and its line each in a render pass of its own with a cleared `depth32float` attachment, body and cap of a segment together as 12 vertices, the ring id written as depth and compared with `not-equal`. Opaque sets keep the old pipeline, so their frames do not change. Two details come from the Viv golden. The first edge of a closed ring is drawn again under an id of its own with a cap at each end, because deck.gl's path layer draws that edge twice in a loop. A fragment a dash covers only partly writes a depth half a step away, so it does not block the neighbouring segment at a dash end.

A set above `maxBufferSize` is left out in the worker, which holds the limit, and the route reports `WebGpuBufferLimitError` once for that set, as the deck.gl WebGPU route does. The device is requested with the adapter's own limit.

A lost device takes option 3. The worker reports the loss and ignores every request until the route answers with `restore`. The route then forgets its atlas, tiles and sent overlays and sends them again, and `whenIdle` keeps waiting instead of rejecting. Three losses within 30 seconds recover and a fourth fails the route, the rule and the constants the Viv route has for a lost WebGL context. `loseDevice` on the route destroys the device for tests.

## Consequences

Measured under SwiftShader ([result](../results/2026-11-15-custom-webgpu-route-labels-translucent-outlines-and-device-loss.md)): ID labels differ from Viv by at most 1 per channel, translucent outlines went from 1.297% to 0.063% of pixels differing against a bound of 0.1%, and a test loses the device twice and gets the same frame back.

A segment instance grew from 24 to 28 bytes for the ring id, and a closed ring carries two more instances for the repeated edge. Where two rings of one set cross, the later ring still blends over the earlier one, as in Viv. A ring that crosses itself blends once there, which Viv blends twice.

Still not built: culling and the level of detail tiers. The route holds every instance of a set in one buffer and lets the GPU clip what is off screen. The route option `gpuTiming` makes the worker time the render pass with `timestamp-query`, and `gpu-bench/custom-gpu-timing.spec.ts` measured 114.82 ms a frame for 1.6M nuclei at detail zoom and 21.12 ms of overlay time for 81k nuclei at overview on the Mac's GPU, against budgets of 6 ms and 1 ms. Both therefore have to be built before the route leaves the developer picker.
