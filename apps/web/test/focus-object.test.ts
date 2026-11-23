import assert from "node:assert/strict";
import { test } from "node:test";
import { areaFocusOf, cellNumberOf, reviewObjectOf } from "../src/viewer/focus-object.ts";

test("a cell is read in display and ASCII form", () => {
  assert.equal(cellNumberOf("C145"), 145);
  assert.equal(cellNumberOf("T2·C145"), 145);
  assert.equal(cellNumberOf("T2.C145"), 145);
  assert.equal(cellNumberOf("C145a"), 145);
});

test("regions, drawn shapes and nothing are not cells", () => {
  assert.equal(cellNumberOf("T1"), null);
  assert.equal(cellNumberOf("T1+"), null);
  assert.equal(cellNumberOf("C7+"), null);
  assert.equal(cellNumberOf(undefined), null);
});

test("an area is centred on its box in either ID form", () => {
  const areas = [{ object: "T2", size: 1, bounds: { x: 100, y: 200, width: 40, height: 20 } }];
  const found = areaFocusOf("t2", areas);
  assert.ok(found);
  assert.equal(found.area.x + found.area.width / 2, 120);
  assert.equal(found.area.y + found.area.height / 2, 210);
});

test("an object the slide does not have finds nothing", () => {
  assert.equal(areaFocusOf("T9", []), null);
});

const reviewObjects = [
  { object: "T1", drawn: true },
  { object: "T2", drawn: false },
  { object: "C5" },
];

test("a review object is found by its own ID", () => {
  assert.equal(reviewObjectOf("T2", reviewObjects), "T2");
  assert.equal(reviewObjectOf("c5", reviewObjects), "C5");
});

test("a drawn ID with a plus finds the drawn review object", () => {
  assert.equal(reviewObjectOf("T1+", reviewObjects), "T1");
  assert.equal(reviewObjectOf("T1⁺", reviewObjects), "T1");
});

test("a plus ID never finds an AI review object", () => {
  assert.equal(reviewObjectOf("T2+", reviewObjects), undefined);
  assert.equal(reviewObjectOf("T9", reviewObjects), undefined);
  assert.equal(reviewObjectOf(undefined, reviewObjects), undefined);
});
