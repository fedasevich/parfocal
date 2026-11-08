import assert from "node:assert/strict";
import { test } from "node:test";
import {
  colorizeFieldMap,
  createFieldMapOverlay,
  defaultFieldMapOpacity,
  type FieldMapKind,
  fieldMapColor,
  fieldMapKinds,
  fieldMapStops,
  type HeatmapGrid,
  heatmapStrengthState,
  heatmapStrengthSteps,
  snapHeatmapStrength,
} from "../../src/index.ts";

const area = { x: 0, y: 0, width: 400, height: 300 };

function gridOf(values: readonly number[]): HeatmapGrid {
  return { width: values.length, height: 1, values: new Float32Array(values), area };
}

const hex = (rgb: readonly number[]) =>
  `#${rgb.map((part) => part.toString(16).padStart(2, "0")).join("")}`;

for (const kind of fieldMapKinds) {
  test(`the ${kind} ramp starts and ends on its published stops`, () => {
    const stops = fieldMapStops[kind];
    assert.equal(hex(fieldMapColor(kind, 0)), stops[0]);
    assert.equal(hex(fieldMapColor(kind, 1)), stops[stops.length - 1]);
  });
}

test("the density ramp matches the approved mock", () => {
  assert.deepEqual(fieldMapStops.density, ["#7c3aed", "#f97316", "#facc15"]);
});

test("cells under the threshold are transparent and keep their colour", () => {
  const kind: FieldMapKind = "density";
  const rgba = colorizeFieldMap(kind, gridOf([0.1, 0.5, 0.9, Number.NaN]), 0.5);
  assert.deepEqual([rgba[3], rgba[7], rgba[11], rgba[15]], [0, 255, 255, 0]);
  assert.deepEqual([...rgba.slice(0, 3)], [...fieldMapColor(kind, 0.1)]);
});

test("a map overlay is a heatmap-kind raster with the map opacity", () => {
  const overlay = createFieldMapOverlay("confidence", { id: "conf", grid: gridOf([0, 1]) });
  assert.equal(overlay.kind, "heatmap");
  assert.equal(overlay.opacity, defaultFieldMapOpacity);
  assert.equal(overlay.raster.rgba.length, 8);
});

test("a grid with a missing cell is refused", () => {
  assert.throws(() => colorizeFieldMap("density", { ...gridOf([0, 1]), height: 2 }, 0), RangeError);
});

test("the strength slider is off or 20 to 100 in steps of ten", () => {
  assert.deepEqual([...heatmapStrengthSteps], [0, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  assert.equal(snapHeatmapStrength(10), 0);
  assert.equal(snapHeatmapStrength(14), 0);
  assert.equal(snapHeatmapStrength(15), 20);
  assert.equal(snapHeatmapStrength(55), 60);
  assert.equal(snapHeatmapStrength(140), 100);
  assert.equal(snapHeatmapStrength(Number.NaN), 0);
});

test("off hides the heatmap and each step sets its opacity", () => {
  assert.deepEqual(heatmapStrengthState(0), { visible: false, opacity: 0 });
  assert.deepEqual(heatmapStrengthState(20), { visible: true, opacity: 0.2 });
  assert.deepEqual(heatmapStrengthState(100), { visible: true, opacity: 1 });
});
