# 0112. The finest level magnifies with nearest sampling through a guarded Viv patch, and a lost WebGL context is rebuilt from the route's own state

- Date: 2026-10-26
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-007 (interpolation rule) and VIEW-034 (GPU error handling). Touches VIEW-002 (Viv route on WebGL2 for RGB brightfield), VIEW-030 (memory and teardown correctness), VIEW-032 (idle means zero work), VIEW-033 (hidden tab and background scheduling), VIEW-036 (renderer interface and route switching) and VIEW-037 (deck.gl 9.4 WebGPU route).

## Context

POC doc 06 records that Viv draws the finest pyramid level with nearest sampling and every coarser level with linear sampling, because bilinear magnification of native data invents intensities nobody measured. Viv's `XRLayer` follows that rule. The route draws interleaved RGB, which Viv 0.23 sends through its own `BitmapLayer`, and that layer ignores the `interpolation` prop and always creates its texture with a linear sampler. The CMU-1.svs 40x golden therefore showed smoothed pixels, and the rule of the POC was not in force on the route.

VIEW-007 also asks for a half-texel inset to avoid bleeding across tiles. The POC needed that inset because its WebGPU engine packed tiles into one atlas, where a bilinear kernel on a slot border reads the neighbour slot. The Viv route gives every tile its own texture.

VIEW-034 asks for context loss recovery on WebGL. luma.gl 9.4.2 listens for `webglcontextlost` but does not cancel it, so the browser never restores the context, and nothing in deck.gl 9.4 rebuilds a device after a restore. A restored context is also the same context object that the dead device was built on.

## Options considered

Where the rule lives:

1. Replace `renderSubLayers` on the `MultiscaleImageLayer` with our own tile layer. Full control, but it copies Viv's tile bounds, `addAlpha` and photometric handling, so every Viv upgrade has to be compared by hand.
2. Patch `updateState` of Viv's `BitmapLayer` once, as ADR 0103 does for `XRLayer`. The patch reads the `tileId.z` Viv already passes to every tile sublayer and the route's own `interpolationRule` prop, and sets a shared sampler on the finest level's texture after Viv created it. Coarser tiles and the background image never reach our code.
3. Set `textureParameters` on deck.gl's `BitmapLayer`. Viv hands that layer a ready luma.gl texture, so the prop is never applied.

What the finest level does when its texels are smaller than a screen pixel:

1. Nearest in both directions, as the POC did. On CMU-1.svs this shows between 10x and 20x, where the finest level is drawn at 0.5 to 1 screen pixels per texel, and nearest then skips texels and aliases.
2. Nearest for magnification and linear for minification (`magFilter: "nearest"`, `minFilter: "linear"`). The GPU picks the filter from the texel footprint, so no zoom logic is needed. Crisp pixels appear exactly when a texel is larger than a screen pixel, which is the case the rule exists for.

The half-texel inset:

1. Shrink the sampled area of every tile by half a texel in the shader. This is what an atlas needs, and on a per-tile texture it would stretch each tile and misplace it.
2. Keep one texture per tile with `clamp-to-edge`. A bilinear kernel on the border then reads the border texel again instead of the neighbour, which is the same guarantee the inset gives an atlas. Tests prove it with tiles of opposite colours.

Recovery of a lost context:

1. Reuse the canvas and build a new Deck on the restored context. A second device on the same context object would sit next to every handle the old device created, and the old device cannot be told apart from a live one. This option was not tried.
2. Replace the canvas and the Deck. The route keeps the camera, the slide, the decode reader, the Viv levels and the overlay descriptions, so a rebuild creates a fresh canvas, `Deck`, slide layer and overlay layers from that state. The old Deck goes through `disposeDeck`.
3. Create the new canvas at once, without waiting for the restore. After a GPU process crash the browser may refuse a new context until the restore, and waiting for the event is the documented pattern.

When recovery is impossible:

1. Retry forever. A viewer that never recovers looks frozen.
2. Give up when the restore does not come within 5 seconds of visible time, or when more than 3 losses happen within 30 seconds, and report one typed error through the route's `onError`.

## Decision

Patch Viv's `BitmapLayer` (option 2), use nearest magnification with linear minification for the finest level, rely on per-tile `clamp-to-edge` textures for the inset, rebuild with a new canvas and Deck on restore, and give up on the limits above.

- `src/viv/interpolation.ts` exports `installTileInterpolation`, which patches `BitmapLayer.prototype.updateState` once. A texture is styled once. Samplers are cached per device in a `WeakMap`, so a rebuilt device never reuses a lost one and the finest tiles share one sampler instead of creating one each. The route option `interpolation: "linear"` switches the rule off and is the negative control of the tests.
- `src/viv/gpu-recovery.ts` holds `createGpuGuard`, which cancels `webglcontextlost`, waits for `webglcontextrestored`, calls the route's `rebuild`, and counts losses. The restore timeout only runs while the tab is visible. `GpuUnrecoverableError` carries a stable `reason` (`restore-timeout`, `repeated-loss` or `rebuild-failed`) and a `userMessage` a UI can show.
- The Viv route stops the old Deck's loop on a loss, does not touch the Deck while the context is lost, keeps recording camera and overlay changes, and applies them in the rebuild. After an unrecoverable failure it releases the GPU, resolves `whenIdle`, ignores later calls and reports exactly one error. GL errors reported while the context is lost are dropped. `route.canvas` and `route.deck` are now getters, because a rebuild replaces both. `route.gpu` exposes the guard's status, counters and failure.
- `src/viv/webgpu-errors.ts` holds `watchWebGpuDevice` (an `uncapturederror` listener that counts, cancels the console message and reports, plus a `device.lost` handler that ignores a deliberate destroy) and `withErrorScopes` (push in order, pop in reverse, always pop, name the filter). Both return something that can be stopped and are unit-tested against a fake device. VIEW-037 (deck.gl 9.4 WebGPU route) is meant to call them. No WebGPU route was built.

The numbers behind the decision are in the [result](../results/2026-10-26-finest-level-sampling-and-context-recovery.md).

## Consequences

- The CMU-1.svs 40x golden changed on purpose. Nothing else did. Two goldens were added, one at 80x and one at 4x centred on a tile corner.
- A Viv upgrade must keep passing the finest level tests, because the patch reads Viv's `tileId` and wraps `updateState`.
- Seams at linear levels cannot appear from bleeding, because of `clamp-to-edge`. One texel of each tile border is a plateau instead of a blend, which is invisible at the minification the tile pyramid keeps linear levels at.
- A viewer in the `failed` state has no canvas. The UI must show `userMessage` and offer a reload.
- TODO: the owner decides the wording of `userMessage`, the 5 second timeout and the limit of 3 losses in 30 seconds, which are the agent's simplest reversible choices.
- TODO: the owner decides whether the finest level should also be nearest when minified, as the POC and Viv's `XRLayer` do.
- TODO: VIEW-052 (hidden tab check in headed Chrome) should also run a real loss while the tab is hidden. Headless Chrome cannot hide a tab, so the hidden case is covered by a unit test of the guard only.
