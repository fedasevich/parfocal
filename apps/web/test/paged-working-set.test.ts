import assert from "node:assert/strict";
import { test } from "node:test";
import { isUnsureCell, numberOfRow, PagedCells } from "@parfocal/viewer-engine";
import { pagedCellSource } from "../src/lab/paged-cell-source.ts";
import { fieldAround, slideExtent } from "../src/screens/review/paged-review.ts";
import { buildUnsureIndex } from "../src/screens/review/unsure-index.ts";
import {
  fieldCentreOf,
  fieldKeyOf,
  MAX_FIELDS,
  WorkingSet,
} from "../src/screens/review/working-set.ts";

const cells = 250_000;

test("a field key snaps a point and returns its centre", () => {
  const key = fieldKeyOf({ x: 4110, y: 2490 });
  assert.deepEqual(fieldCentreOf(key), { x: 4000, y: 2500 });
});

test("the unsure index spans the whole slide and the working set keeps pinned cells", async () => {
  const opened = await PagedCells.open(pagedCellSource({ cells }));
  const [, , right, bottom] = slideExtent(opened.summary);
  const index = await buildUnsureIndex(
    opened,
    { isUnsureCell, numberOfRow, yieldNow: () => Promise.resolve() },
    () => false,
  );
  assert.ok(index.length > 1000 && index.length < cells / 4, `indexed ${index.length}`);
  const xs = index.map((cell) => cell.x);
  assert.ok(Math.min(...xs) < right * 0.1 && Math.max(...xs) > right * 0.9);
  const ys = index.map((cell) => cell.y);
  assert.ok(Math.min(...ys) < bottom * 0.1 && Math.max(...ys) > bottom * 0.9);

  const set = new WorkingSet();
  const first = opened.unsureIn(fieldAround({ x: 800, y: 500 }, 1600, 1000), 50);
  set.addField("1:1", first);
  const kept = first[0];
  assert.ok(kept);
  set.pin([`C${kept.number}`]);
  for (let at = 0; at < MAX_FIELDS + 2; at++) {
    const centre = { x: 3000 + at * 800, y: 3000 };
    set.addField(fieldKeyOf(centre), opened.unsureIn(fieldAround(centre, 1600, 1000), 50));
  }
  assert.ok(set.has(`C${kept.number}`));
  const dropped = first[1];
  assert.ok(dropped);
  assert.equal(set.has(`C${dropped.number}`), false);
  set.setIndex(index);
  assert.ok(set.size() >= index.length);
  opened.close();
});
