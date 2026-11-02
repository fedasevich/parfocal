import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colorizeHeatmap,
  colormapColor,
  colormapCssGradient,
  createHeatmapOverlay,
  defaultHeatmapLook,
  defaultHeatmapOpacity,
  type HeatmapGrid,
  heatmapColormaps,
  heatmapSourceLabel,
  isHeatmapOverlay,
  isOverlayDescription,
  withHeatmapLook,
  withOverlayState,
} from "../../src/index.ts";

const area = { x: 0, y: 0, width: 400, height: 300 };

const source = { model: "CAMELYON tumor model", version: "v1.0" };

function gridOf(values: readonly number[], width = values.length): HeatmapGrid {
  return {
    width,
    height: values.length / width,
    values: new Float32Array(values),
    area,
  };
}

const alphaOf = (rgba: Uint8Array, cell: number) => rgba[cell * 4 + 3];
const colorOf = (rgba: Uint8Array, cell: number) => [...rgba.subarray(cell * 4, cell * 4 + 3)];

test("each colormap starts and ends on the colours of its published table", () => {
  assert.deepEqual(colormapColor("viridis", 0), [0x44, 0x01, 0x54]);
  assert.deepEqual(colormapColor("viridis", 1), [0xfd, 0xe7, 0x25]);
  assert.deepEqual(colormapColor("inferno", 0), [0x00, 0x00, 0x04]);
  assert.deepEqual(colormapColor("inferno", 1), [0xfc, 0xff, 0xa4]);
  assert.deepEqual(colormapColor("turbo", 0), [35, 23, 27]);
  assert.deepEqual(colormapColor("turbo", 1), [144, 12, 0]);
});

test("the middle of each colormap is near the mock's gradient stop for it", () => {
  const near = (actual: readonly number[], expected: readonly number[], tolerance: number) => {
    expected.forEach((channel, index) => {
      assert.ok(
        Math.abs((actual[index] ?? 0) - channel) <= tolerance,
        `${actual.join()} vs ${expected.join()}`,
      );
    });
  };
  near(colormapColor("viridis", 0.5), [0x21, 0x91, 0x8c], 6);
  near(colormapColor("inferno", 0.5), [0xbc, 0x37, 0x54], 12);
  near(colormapColor("turbo", 0.5), [0xa2, 0xfc, 0x3c], 30);
});

test("the three colormaps give three different colours at every quarter", () => {
  for (const value of [0.25, 0.5, 0.75]) {
    const colours = heatmapColormaps.map((name) => colormapColor(name, value).join());
    assert.equal(new Set(colours).size, 3, `value ${value}`);
  }
});

test("a colormap value outside 0 to 1 or not a number takes the end colours", () => {
  assert.deepEqual(colormapColor("viridis", -4), colormapColor("viridis", 0));
  assert.deepEqual(colormapColor("viridis", 9), colormapColor("viridis", 1));
  assert.deepEqual(colormapColor("viridis", Number.NaN), colormapColor("viridis", 0));
});

test("a colormap gradient lists its stops from 0 to 100 percent", () => {
  const gradient = colormapCssGradient("viridis", 3);
  assert.equal(
    gradient,
    "linear-gradient(90deg, rgb(68 1 84) 0%, rgb(33 145 140) 50%, rgb(253 231 37) 100%)",
  );
});

test("cells under the threshold are transparent and the rest are opaque in their colour", () => {
  const rgba = colorizeHeatmap(gridOf([0, 0.07, 0.08, 0.5, 1]), defaultHeatmapLook);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((cell) => alphaOf(rgba, cell)),
    [0, 0, 255, 255, 255],
  );
  assert.deepEqual(colorOf(rgba, 3), [...colormapColor("viridis", 0.5)]);
  assert.deepEqual(colorOf(rgba, 1), [...colormapColor("viridis", 0.07)]);
});

test("a threshold of 0 shows every cell that holds a number and a threshold of 1 only certainty", () => {
  const grid = gridOf([0, 0.5, 0.99, 1]);
  const all = colorizeHeatmap(grid, { colormap: "inferno", threshold: 0 });
  const top = colorizeHeatmap(grid, { colormap: "inferno", threshold: 1 });
  assert.deepEqual(
    [0, 1, 2, 3].map((cell) => alphaOf(all, cell)),
    [255, 255, 255, 255],
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((cell) => alphaOf(top, cell)),
    [0, 0, 0, 255],
  );
});

test("a cell that is not a number draws nothing", () => {
  const rgba = colorizeHeatmap(gridOf([Number.NaN, 0.9]), { colormap: "turbo", threshold: 0 });
  assert.deepEqual([alphaOf(rgba, 0), alphaOf(rgba, 1)], [0, 255]);
});

test("bytes are read as probabilities from 0 to 255", () => {
  const grid: HeatmapGrid = { width: 2, height: 1, values: new Uint8Array([20, 255]), area };
  const rgba = colorizeHeatmap(grid, { colormap: "viridis", threshold: 0.5 });
  assert.deepEqual([alphaOf(rgba, 0), alphaOf(rgba, 1)], [0, 255]);
  assert.deepEqual(colorOf(rgba, 1), [...colormapColor("viridis", 1)]);
});

test("a grid with the wrong number of values is refused", () => {
  const grid: HeatmapGrid = { width: 3, height: 2, values: new Float32Array(5), area };
  assert.throws(() => colorizeHeatmap(grid, defaultHeatmapLook), RangeError);
});

test("a heatmap overlay starts at the mock's strength, viridis and threshold", () => {
  const overlay = createHeatmapOverlay({ id: "heat", grid: gridOf([0.1, 0.9]), source });
  assert.equal(overlay.kind, "heatmap");
  assert.equal(overlay.opacity, defaultHeatmapOpacity);
  assert.equal(defaultHeatmapOpacity, 0.7);
  assert.deepEqual(overlay.heatmap.look, { colormap: "viridis", threshold: 0.08 });
  assert.equal(overlay.raster.smooth, true);
  assert.equal(overlay.raster.rgba.length, 8);
  assert.ok(isOverlayDescription(overlay));
  assert.ok(isHeatmapOverlay(overlay));
});

test("opacity and visibility can be set when the overlay is made", () => {
  const overlay = createHeatmapOverlay({
    id: "heat",
    grid: gridOf([0.5]),
    source,
    opacity: 0.2,
    visible: false,
  });
  assert.equal(overlay.opacity, 0.2);
  assert.equal(overlay.visible, false);
});

test("a heatmap threshold is held between 0 and 1 and a bad colormap or number is refused", () => {
  const grid = gridOf([0.5]);
  assert.equal(
    createHeatmapOverlay({ id: "h", grid, source, threshold: 3 }).heatmap.look.threshold,
    1,
  );
  assert.equal(
    createHeatmapOverlay({ id: "h", grid, source, threshold: -1 }).heatmap.look.threshold,
    0,
  );
  assert.throws(
    () => createHeatmapOverlay({ id: "h", grid, source, threshold: Number.NaN }),
    RangeError,
  );
  assert.throws(
    () => createHeatmapOverlay({ id: "h", grid, source, colormap: "jet" as "viridis" }),
    RangeError,
  );
});

test("changing the look recolours from the grid and keeps strength, visibility and source", () => {
  const first = withOverlayState(
    createHeatmapOverlay({ id: "heat", grid: gridOf([0.05, 0.25, 0.75]), source }),
    { opacity: 0.35, visible: false },
  );
  const next = withHeatmapLook(first, { colormap: "turbo", threshold: 0.5 });
  assert.equal(next.opacity, 0.35);
  assert.equal(next.visible, false);
  assert.equal(next.heatmap.source, source);
  assert.equal(next.heatmap.grid, first.heatmap.grid);
  assert.deepEqual(next.heatmap.look, { colormap: "turbo", threshold: 0.5 });
  assert.notEqual(next.raster, first.raster);
  assert.deepEqual(
    [0, 1, 2].map((cell) => alphaOf(next.raster.rgba as Uint8Array, cell)),
    [0, 0, 255],
  );
  assert.deepEqual(colorOf(next.raster.rgba as Uint8Array, 2), [...colormapColor("turbo", 0.75)]);
  assert.deepEqual(first.heatmap.look, defaultHeatmapLook);
});

test("changing only the threshold keeps the colormap, and the reverse", () => {
  const first = createHeatmapOverlay({
    id: "heat",
    grid: gridOf([0.5]),
    source,
    colormap: "inferno",
  });
  assert.deepEqual(withHeatmapLook(first, { threshold: 0.2 }).heatmap.look, {
    colormap: "inferno",
    threshold: 0.2,
  });
  assert.deepEqual(withHeatmapLook(first, { colormap: "turbo" }).heatmap.look, {
    colormap: "turbo",
    threshold: 0.08,
  });
});

test("an overlay with a state change still knows its heatmap", () => {
  const overlay = withOverlayState(
    createHeatmapOverlay({ id: "heat", grid: gridOf([0.5]), source }),
    {
      opacity: 0.5,
    },
  );
  assert.ok(isHeatmapOverlay(overlay));
});

test("the source chip names the model and its version", () => {
  assert.equal(heatmapSourceLabel(source), "CAMELYON tumor model v1.0");
  assert.equal(heatmapSourceLabel({ model: "Synthetic field", version: null }), "Synthetic field");
});
