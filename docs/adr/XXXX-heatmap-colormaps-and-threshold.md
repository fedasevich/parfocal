# XXXX. A heatmap is a probability grid coloured in the engine, with fixed colormap tables and a hide-below threshold

- Date: 2026-11-03
- Status: Accepted
- Deciders: Yurii Fedas
- Backlog: AITUM-002 (heatmap layer). Builds on [ADR 0108](0108-overlay-layers-as-typed-data-over-deck-gl.md) (overlay layers as typed data over deck.gl) and the style sources in [ADR 0157](0157-outline-casings-and-overlay-style-sources.md) (outline casings and overlay style sources). Touches VIZ-003 (heatmap, density and confidence maps) and VIZ-007 (Display panel).

## Context

The raster overlay kind `heatmap` took ready-made RGBA pixels, so every caller had to colour its own probabilities and a colormap or threshold change meant rebuilding the picture by hand. The task asks for the colormaps viridis, inferno and turbo, an opacity, a threshold and a source chip that names the model.

## Options considered

Where the colouring happens:

1. In a fragment shader, with the probability grid as a float texture and the colormap as a lookup texture. A change is a uniform write, but it needs a custom deck.gl layer and float textures that SwiftShader and some GPUs filter badly.
2. On the CPU, once per change, into the RGBA raster the existing `BitmapLayer` already draws. A 512 by 512 grid is 262,144 cells, a plain loop over a 256-entry table.

Where the colormap values come from:

1. A polynomial or piecewise approximation for each map.
2. The 256-entry tables that matplotlib publishes for viridis and inferno (CC0 licence), and the 256 values of Google's turbo polynomial (Apache 2.0) evaluated once and stored.

## Decision

Option 2 for both.

- `createHeatmapOverlay` takes a `HeatmapGrid` (width, height, values from 0 to 1 as `Float32Array`, or bytes from 0 to 255, and the slide area), a `HeatmapSource` (model name and version) and a look of colormap and threshold. It returns a raster overlay of kind `heatmap` that also keeps the grid, the look and the source, and `withHeatmapLook` colours it again from the kept grid.
- A cell below the threshold gets alpha 0 and keeps its own colour, so linear smoothing at the edge fades alpha and does not blend a dark fringe. A cell at or above the threshold is opaque. A cell that is not a number draws nothing. For a `Float32Array` the threshold is rounded to 32 bits before the comparison, so a grid value of 0.08 is shown at a threshold of 0.08.
- The overlay's opacity (the existing overlay state) is the heatmap's strength. Nothing is baked into the pixels.
- The default look is viridis, threshold 0.08 and opacity 0.7, read from the Heatmap group of the developer drawer in the approved mock (`DV_CMAPS`, the opacity slider at 0.70 and the threshold slider at 0.08). The mock's ramp stops are the same maps (viridis `#440154` to `#fde725`, inferno `#000004` to `#fcffa4`, turbo `#30123b` to `#7a0403` at its seven stops), and a test checks the middle of each table against them. The turbo polynomial runs from `#23171b` to `#900c00`, a little off the mock's `#30123b` and `#7a0403`, which come from a different published table. No other source was compared.
- The source chip is data, not a component. `heatmapSourceLabel` gives "model version" or just the model, and the chip itself is drawn where the legend is drawn (the heatmap maps task and the Display panel task), because the web app must not import the engine statically.
- The golden images cover each colormap (viridis is the default heatmap golden, inferno and turbo have their own), a raised threshold, a threshold above every cell, and a live change that must equal a fresh render.

## Consequences

- `src/overlay/colormap-data.ts` holds 3 x 768 hex characters. A test pins the end colours of each table.
- The heatmap fixture of the golden harness is now a two-peak probability grid, so the heatmap and stack goldens were regenerated.
- A colormap change recolours on the CPU and uploads one new texture. Nothing was measured here. The heatmap maps task (VIZ-003), which owns the slider, must measure a 512 by 512 grid.
