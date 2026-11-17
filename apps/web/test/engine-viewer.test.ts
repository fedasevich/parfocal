import assert from "node:assert/strict";
import { test } from "node:test";
import {
  nextOpenObject,
  outlineArea,
  placedObjects,
  startCamera,
} from "../src/viewer/stage-geometry.ts";

test("a deep link camera lands on the same spot of the real slide", () => {
  const camera = startCamera({ x: 0.25, y: 0.75, scale: 4 }, { width: 4000, height: 2000 }, -3);
  assert.deepEqual(camera, { x: 1000, y: 1500, zoom: -1 });
});

test("a scale below one keeps the fitted zoom", () => {
  assert.equal(startCamera({ x: 0, y: 0, scale: 0.5 }, { width: 10, height: 10 }, -2).zoom, -2);
});

test("an object's area is a square twice its outline, centred on it", () => {
  assert.deepEqual(outlineArea([100, 100, 200, 100, 200, 150]), {
    x: 50,
    y: 25,
    width: 200,
    height: 200,
  });
  assert.equal(outlineArea(null), null);
  assert.equal(outlineArea([1, 2]), null);
});

test("guided review steps to the next open object and wraps round", () => {
  const order = ["T1", "T2", "T3", "T4"];
  assert.equal(nextOpenObject(order, new Set(), null), "T1");
  assert.equal(nextOpenObject(order, new Set(["T1", "T2"]), "T2"), "T3");
  assert.equal(nextOpenObject(order, new Set(["T3", "T4"]), "T4"), "T1");
  assert.equal(nextOpenObject(order, new Set(order), "T2"), null);
});

test("only objects with an outline in slide pixels are drawn on the slide", () => {
  const placed = placedObjects([
    { object: "T1", class_name: "Tumor", score: 0.9, outline: [0, 0, 10, 0, 10, 10] },
    { object: "T2", class_name: "Lymphocyte", score: 0.4, outline: [0, 0, 10, 0, 10, 10] },
    { object: "T3", class_name: "Tumor", score: 0.8, outline: null },
    { object: "T4", class_name: "Tumor", score: 0.8 },
  ]);
  assert.deepEqual(
    placed.map((item) => [item.id, item.className]),
    [
      ["T1", "tumor"],
      ["T2", "other"],
    ],
  );
});
