# 0402. The Viv route draws the slide once per change, after updating its layers

- Date: 2026-11-19
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: VIEW-074 (every viewer screen draws the real slide through one engine stage). Builds on [ADR 0353](0353-main-path-budgets-p95-after-warm-up.md) (main path budgets are a 95th percentile after a warm-up) and [ADR 0399](0399-cells-draw-as-dots-while-a-software-renderer-moves.md) (cells draw as dots while a software renderer moves).

## Context

After PROTO-035 (the fake AI cells sit on the slide) the guided check really flies the camera, and `apps/web/e2e/decision-next-object.spec.ts` (a decision puts the next object on screen within budget) took 259 to 373 ms on CI against a budget of 126 ms. Under software GL every draw is read back, so a frame costs what it draws. Three costs were found in the Linux Playwright container with Chromium on SwiftShader pinned to one core.

- Every camera frame drew the slide twice. `changed()` in `viv-route.ts` forced `deck.redraw`, that draw only marked the tile layer for an update, and deck's own loop then updated it and drew again.
- Every draw painted Viv's low resolution background image under tiles that already covered the whole view. That was about 18 of 57 ms per draw.
- `stopMotion` first stepped the animation to the present, which moved the camera and cost one more draw on the key press that ends a flight.

## Options considered

| Option | Result |
| --- | --- |
| 1. Drop the forced draw and let deck's loop draw | One draw, but the slide can lag one frame behind the DOM overlays, depending on which frame callback runs first |
| 2. Keep the forced draw and stop deck's loop from drawing again | Tiles are still chosen for the previous viewport, and deck's loop cannot be told apart from a real redraw |
| 3. On a change, give the composite layers the viewport, update the layers, then draw once, in a microtask | One draw in the same frame as the overlays, tiles chosen for the current viewport, several changes in one task share one draw. Reads three deck internals |
| 4. Always exclude Viv's background image | Fastest, but the slide is blank while tiles load |
| 5. Skip the background only when opaque tiles cover the view | Same pixels as before, the saving applies whenever the view is inside the slide and loaded |

## Decision

Options 3 and 5, and `stopMotion` stops where the last frame drew.

- `viv/draw-once.ts` holds the one draw. `changed()` queues it in a microtask, so it never runs inside deck's own update or draw. `settled()` also waits while the layer manager still has an update queued.
- `viv/slide-image-layer.ts` extends Viv's `MultiscaleImageLayer` and filters out the background sublayer when the view lies inside the slide and every selected tile is loaded, has an image, has finished its fade and the tile boxes cover the view (`viv/tile-cover.ts`). Anything else draws the background as before.
- The redraw at the end of a tile fade no longer depends on something polling `settled()` while the fade runs. The route compares the fade's end time with the start of its last draw. The old flag was lost when the page got no frame during the fade, which is what made goldens such as `viv-cmu-1-small-region-converted-zarr-fit` fail now and then with soft tiles.
- The camera controller gains `halt`, which ends a motion without the catch-up step. `engine.stopMotion` uses it. `cancel` keeps its catch-up for pan, drag and zoom.

## Consequences

Measured with the bench that replays the spec in the Playwright 1.65.1 container, fastest and median of two runs of 12 decisions:

| Setup | Before | After |
| --- | --- | --- |
| 1 core, fastest | 187 to 191 ms | 56 to 59 ms |
| 1 core, median | 219 to 225 ms | 67 to 72 ms |
| 1 core, frame during a flight | 103 to 104 ms | 38 ms |
| 2 cores, fastest | 104 to 106 ms | 43 to 47 ms |
| 2 cores, median | 172 to 180 ms | 64 to 71 ms |

The CI number is `TODO` until the branch runs there. The route now depends on deck's `layerManager.needsUpdate`, `updateLayers` and `activateViewport` and on Viv's sublayer ids `Background-Image-` and `Tiled-Image-`, so a deck or Viv upgrade must rerun the goldens and `test/viv/draw-once.test.ts`. The Deck WebGPU route still forces its own draw and is not changed here. Going back means restoring the forced `deck.redraw` in `changed()` and using `MultiscaleImageLayer` directly.
