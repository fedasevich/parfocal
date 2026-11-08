import assert from "node:assert/strict";
import { test } from "node:test";
import { placeMinimap } from "../src/screens/viewer-tools/minimap-placement.ts";
import {
  chromeBlocks,
  heldPlacement,
  hotWeight,
  measurementSamples,
  measurementSpots,
  weighted,
} from "../src/screens/viewer-tools/minimap-weights.ts";

const canvas = { width: 1048, height: 856 };
const full = { width: 208, height: 301 };
const compact = { width: 162, height: 190 };

test("the weights keep the mock order and the chosen ones sit between the mock's", () => {
  assert.ok(hotWeight.tumorEdge < hotWeight.cellToCheck);
  assert.ok(hotWeight.cellToCheck < hotWeight.proposal);
  assert.ok(hotWeight.proposal < hotWeight.pin);
  assert.ok(hotWeight.pin < hotWeight.currentCell);
  assert.ok(hotWeight.currentCell < hotWeight.measurementSample);
});

test("a measurement is sampled at eleven points of 200 each", () => {
  const spots = measurementSpots([0, 0], [100, 0]);
  assert.equal(spots.length, measurementSamples);
  assert.deepEqual(spots[10], [100, 0, 200]);
});

test("the reading scene keeps the bottom right with the tumor edge elsewhere", () => {
  const edge = weighted(
    [
      [300, 300],
      [320, 320],
      [600, 400],
    ],
    hotWeight.tumorEdge,
  );
  assert.equal(placeMinimap(canvas, full, edge, []).corner, "bottom-right");
});

test("the measuring scene moves the map to the bottom left", () => {
  const ruler = measurementSpots(
    [canvas.width - 330, canvas.height - 190],
    [canvas.width - 95, canvas.height - 130],
  );
  assert.equal(placeMinimap(canvas, full, ruler, []).corner, "bottom-left");
});

test("the cells scene leaves the corner holding the current cell", () => {
  const cell = weighted([[canvas.width - 100, canvas.height - 100]], hotWeight.currentCell);
  const others = weighted(
    [
      [40, 40],
      [60, 60],
    ],
    hotWeight.cellToCheck,
  );
  assert.equal(placeMinimap(canvas, compact, [...cell, ...others], []).corner, "bottom-left");
});

test("a pin outweighs a proposal when the only choice is between them", () => {
  const proposal = weighted([[canvas.width - 100, canvas.height - 100]], hotWeight.proposal);
  const pin = weighted([[100, canvas.height - 100]], hotWeight.pin);
  const topBar: [number, number, number, number] = [0, 0, canvas.width, 60];
  const place = placeMinimap(canvas, compact, [...proposal, ...pin], [topBar]);
  assert.equal(place.corner, "bottom-right");
});

test("an open thread and the cells panel block their corners", () => {
  const blocks = chromeBlocks({
    openThread: [canvas.width - 330, canvas.height - 300, 316, 280],
    cellsPanel: [0, canvas.height - 300, 260, 300],
    legend: null,
  });
  assert.equal(blocks.length, 2);
  assert.equal(placeMinimap(canvas, full, [], blocks).corner, "top-right");
});

test("the corner is held while the camera pans and applied at rest", () => {
  assert.equal(heldPlacement("bottom-left", "top-right", true), "bottom-left");
  assert.equal(heldPlacement("bottom-left", "top-right", false), "top-right");
  assert.equal(heldPlacement(null, "top-right", true), "top-right");
});
