import assert from "node:assert/strict";
import { test } from "node:test";
import { PagedCells } from "@parfocal/viewer-engine";
import { pagedCellSource } from "../src/lab/paged-cell-source.ts";
import {
  cellObjectId,
  circlePath,
  fieldAround,
  pagedCountFrom,
  placeholderShapes,
  reviewObjectOf,
  slideExtent,
} from "../src/screens/review/paged-review.ts";

const cells = 250_000;

test("the paged count is read only from a whole number of at least one thousand", () => {
  assert.equal(pagedCountFrom("?task=a&pagedCells=250000"), 250_000);
  assert.equal(pagedCountFrom("?pagedCells=12"), null);
  assert.equal(pagedCountFrom("?pagedCells=lots"), null);
  assert.equal(pagedCountFrom(""), null);
});

test("a 250,000 cell result pages in and holds only the cells near the view", async () => {
  const opened = await PagedCells.open(pagedCellSource({ cells }));
  assert.equal(opened.summary.count, cells);
  assert.equal(opened.paged, true);
  const [, , right, bottom] = slideExtent(opened.summary);
  const view = fieldAround({ x: right / 2, y: bottom / 2 }, 1600, 1000);
  await opened.show(view);
  const held = opened.stats().residentCells;
  assert.ok(held > 0 && held < cells / 10, `held ${held}`);
  const unsure = opened.unsureIn(view, 300);
  assert.ok(unsure.length > 100);
  const tops = unsure.map((item) => item.confidence?.top ?? 0);
  assert.deepEqual(
    tops,
    [...tops].sort((a, b) => a - b),
  );
  const shapes = placeholderShapes(unsure, opened);
  assert.equal(Object.keys(shapes).length, unsure.length);
  const first = unsure[0];
  assert.ok(first);
  const object = reviewObjectOf(first, ["Tumor", "Stroma", "Immune", "Other"]);
  assert.equal(object.object, cellObjectId(first.number));
  assert.equal(object.kind, "cell");
  assert.equal(object.score, first.confidence?.top);
  assert.notEqual(object.other_class, object.class_name);
  const found = await opened.cell(first.number);
  assert.equal(found?.probs?.length, 4);
  opened.close();
});

test("a circle path closes and starts at the left edge", () => {
  assert.match(circlePath(10, 20, 3), /^M7\.0,20\.0A3\.0,3\.0 .*Z$/);
});
