# 0103. Shared deck memory settings, a patched uint8 upload and a memory test baseline taken after one warm-up cycle

- Date: 2026-10-23
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: VIEW-030 (memory and teardown correctness). Touches VIEW-001 (engine package API), VIEW-002 (Viv route on WebGL2 for RGB brightfield), VIEW-036 (renderer interface and route switching), VIEW-037 (deck.gl 9.4 WebGPU route) and STACK-015 (Viv and deck.gl versions).

## Context

VIEW-030 lists the memory fixes of POC doc 24: destroy the canvas context on dispose, lose the WebGL context, keep one stable `selections` array per slide, upload uint8 as `r8unorm`, MSAA off, picking off and precomputed polygon indices. [ADR 0098](0098-viv-and-deck-gl-versions.md) already decided that the canvas leak gets a dispose wrapper. Three choices were left open.

1. Where the settings live. VIEW-002 builds the Viv route at the same time, and VIEW-037 will build a second deck route later.
2. How uint8 channels reach the GPU as `r8unorm`. Viv 0.23's `XRLayer` uploads uint8 as `r8uint` with nearest filtering and as an `r32float` copy with linear filtering. Its fragment shader reads intensities in the 0 to 255 range and applies contrast limits in that range.
3. What "the heap returns to within 10% of baseline" measures. On SwiftShader with the CI fixtures the heap grew 12.7% from the first open to the 20th switch with one deck alive throughout, and heap snapshots put 82% of that growth in V8 compiled code ([result](../results/2026-10-23-memory-teardown-swiftshader.md)).

## Options considered

Where the settings live:

1. Each route sets its own device props, layer props and dispose steps. Simple, but VIEW-002 and VIEW-037 would each have to remember five rules, and doc 24 shows how one forgotten rule costs gigabytes.
2. Small shared modules in `packages/viewer-engine/src/viv`: `dispose-deck.ts` and `deck-settings.ts`, which every deck route imports. One place to test and change.

The uint8 upload:

1. Patch `XRLayer.prototype` once: `dataToTexture` creates `r8unorm` textures for `Uint8Array` data, `getShaders` switches the sampler to `sampler2D` and multiplies the intensity by 255 in Viv's `DECKGL_PROCESS_INTENSITY` hook, so contrast limits stay in 0 to 255. This is the POC's approach plus the rescale. It depends on Viv's internals, so it refuses to run when the hook text changes and steps aside when an extension owns that hook.
2. Keep the texture patch but scale contrast limits by 1/255 in every route. No shader change, but every caller must remember it, and Viv's own padding of hidden channels uses the dtype maximum of 255, which then means something else.
3. A subclass of `XRLayer` passed down instead of the patch. `MultiscaleImageLayer` builds its `XRLayer` internally and offers no way to swap the class, so this means copying Viv's tile and image layers.
4. Change Viv upstream. The right long-term fix, but it does not help the pilot until a release lands.

The memory test baseline:

1. The heap after the first open, as the STACK-015 spike measured. Compiled code for each reader, codec and Viv path is counted as growth, and it failed at 12.7% on SwiftShader with five small slides.
2. The heap after one warm-up cycle that opens every slide once, then 20 switches. Compiled code has been built by then, and the heap was flat from visit 10 to visit 25. A leak still shows: without `canvasContext.destroy()` the heap rose 137.5% over the same baseline.
3. A memory figure without compiled code, such as the sum of live objects from a heap snapshot. Closer to "slide data", but a snapshot per visit is slow and the number is not what the backlog or the spike meant by heap.

## Decision

Option 2 for the location, option 1 for the upload and option 2 for the baseline.

- `src/viv/dispose-deck.ts` exports `disposeDeck(deck, canvas)` with the ADR 0098 steps. It also releases a device that is still being created when the deck is disposed, because `Deck.finalize()` cannot reach it and its canvas context stayed alive in the test.
- `src/viv/deck-settings.ts` exports `deckDeviceProps` (WebGL with `antialias: false`), `unpickableLayerProps` (`pickable: false`), `stableSelections(slide, selections)`, which returns the same frozen array for the same slide and channels, and `installUint8TextureUpload(XRLayer)`.
- The patched upload drew within 1 level of Viv's own textures with both filters. Scaling contrast limits in every route was rejected because it spreads one rule across callers, and the subclass because it means copying Viv's layers.
- The memory test opens five slides once as a warm-up, takes the baseline at the next open and asserts the Done-when line over the 20 switches that follow. It also runs the release without `canvasContext.destroy()` and expects every deck to stay alive, which is the canary ADR 0098 asks for. If upstream fixes the leak the canary fails, and the wrapper can go.

## Consequences

- VIEW-002 and VIEW-037 import these modules instead of setting their own values. The harness route in `packages/viewer-engine/browser/page` is a test route only and goes away once VIEW-002's route can be mounted in the test.
- The `browser` CI job now fetches the `small` fixture group, which shares its cache key with the `test` job.
- A Viv upgrade must pass the r8unorm comparison in `browser/settings.spec.ts`, because the patch reads Viv's shader hook text.
- TODO: offer the `r8unorm` upload and the dispose fix to Viv and deck.gl upstream (owner to decide).
- Precomputed polygon indices are not covered, because the overlay layers do not exist yet. TODO: move that item to the overlay task or keep VIEW-030 open until it is done.
