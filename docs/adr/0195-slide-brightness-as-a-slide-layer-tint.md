# 0195. Slide brightness is a tint on the slide layer inside the engine, not a CSS filter on the viewer

- Date: 2026-11-03
- Status: Proposed
- Deciders: Yurii Fedas
- Backlog: NAV-003 (slide brightness dial). Follows [ADR 0157](0157-outline-casings-and-overlay-style-sources.md) (outline casings and overlay style sources), which asked that the dial change the slide only.

## Context

The brightness popover and its remembered value already existed from the prototype port, and the slide stage dimmed the slide with a CSS `filter: brightness()` on the element that holds the deck.gl canvas. The slide and every overlay draw into that one canvas, so the filter dimmed outlines, heatmaps and pins too, and a class colour no longer matched its legend. The task asks for 20 to 140 percent that changes slide pixels only.

## Options considered

1. Keep the CSS filter and move overlays into a second canvas above the slide. Two canvases must stay in step on every camera move, and the overlay route of [ADR 0108](0108-overlay-layers-as-typed-data-over-deck-gl.md) draws them in one deck.gl pass on purpose.
2. A deck.gl `LayerExtension` on the slide layer that multiplies the colour in `DECKGL_FILTER_COLOR`. Viv's `MultiscaleImageLayer` hands RGB tiles to its `BitmapLayer` with `extensions: []`, so the extension never reaches the tile shader.
3. The `tintColor` prop of deck.gl's `BitmapLayer`, which Viv's tile layer inherits and passes through. The shader multiplies the sampled colour by `tintColor / 255`, a uniform that accepts values above 255, so 140 percent is a tint of 357. Changing it rebuilds the slide layer object with the same id, which deck.gl diffs into a uniform update without refetching tiles.

## Decision

Option 3. The engine gains `setSlideBrightness(percent)` and `getSlideBrightness()`, clamps to 20 to 140 in whole percent, and every renderer route implements `setSlideBrightness(factor)`, so an alternate renderer must carry the dial too. The web app stores the value per device as before and hands it to the engine. Alt+Up and Alt+Down step by 10 and Alt+0 resets to 100.

The settings catalogue range of `slide_brightness` changes from 50 to 150 to 20 to 140 to match.

## Consequences

- `render/viv-brightness.spec.ts` in `packages/golden-images` proves on the synthetic slide that at 20, 60 and 140 percent every slide pixel is the 100 percent pixel times the factor within 1, every opaque outline pixel keeps its exact class colour, and a CSS filter fails that outline check.
- Translucent fills show the dimmed slide through them, which is correct, because only the slide under them changed.
- The tint multiplies sRGB values like the CSS filter did, so 140 percent clips highlights at white. A curve that spares highlights is a later choice.
- Viv's multichannel path draws through `XRLayer`, which has no `tintColor`. The Viv route opens RGB slides only today, so the dial covers every slide it draws. A fluorescence route must add its own.
