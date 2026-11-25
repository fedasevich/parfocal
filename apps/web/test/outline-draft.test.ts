import assert from "node:assert/strict";
import { test } from "node:test";
import { handleIndices, type Ring, simplifyRing } from "../src/annotations/ai-edit.ts";
import {
  crossingEdges,
  insertRingPoint,
  moveRingPoint,
  removeRingPoints,
  ringMidpoints,
} from "../src/annotations/reshape.ts";
import {
  outlineChanged,
  outlineRing,
  pushOutline,
  redoOutline,
  startOutline,
  undoOutline,
} from "../src/viewer/outline-draft.ts";

const square: Ring = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

test("a square has no crossing and a bowtie crosses on two edges", () => {
  assert.deepEqual(crossingEdges(square), []);
  const bowtie = moveRingPoint(square, 2, { x: 0, y: 10 });
  const swapped = moveRingPoint(bowtie, 3, { x: 10, y: 10 });
  assert.deepEqual(crossingEdges(swapped), [1, 3]);
});

test("a point dropped on a far edge counts as a crossing, as the server check does", () => {
  const pentagon: Ring = [...square.slice(0, 3), [5, 12], [0, 10]];
  const touching = moveRingPoint(pentagon, 3, { x: 5, y: 0 });
  assert.ok(crossingEdges(touching).length > 0);
  assert.deepEqual(crossingEdges(pentagon), []);
});

test("a midpoint inserts a point after its edge and removal stops at three points", () => {
  const midpoints = ringMidpoints(square);
  assert.deepEqual(midpoints[3], { from: 3, at: { x: 0, y: 5 } });
  const added = insertRingPoint(square, 0, { x: 5, y: -2 });
  assert.deepEqual(added[1], [5, -2]);
  assert.equal(added.length, 5);
  const triangle = removeRingPoints(square, [1]);
  assert.equal(triangle?.length, 3);
  assert.equal(removeRingPoints(triangle ?? [], [0]), null);
});

test("the draft steps back and forth and knows when it is back at the start", () => {
  let draft = startOutline("R1", square);
  assert.equal(outlineChanged(draft), false);
  draft = pushOutline(draft, moveRingPoint(square, 0, { x: -1, y: -1 }));
  draft = pushOutline(draft, insertRingPoint(outlineRing(draft), 0, { x: 5, y: -3 }));
  assert.equal(outlineRing(draft).length, 5);
  draft = undoOutline(draft);
  assert.equal(outlineRing(draft).length, 4);
  assert.equal(outlineChanged(draft), true);
  draft = undoOutline(undoOutline(draft));
  assert.equal(outlineChanged(draft), false);
  draft = redoOutline(draft);
  assert.deepEqual(outlineRing(draft)[0], [-1, -1]);
  assert.equal(pushOutline(draft, outlineRing(draft)), draft);
});

test("handles of a long outline keep their places in the full ring", () => {
  const circle: Ring = Array.from({ length: 80 }, (_, index) => {
    const angle = (index / 80) * Math.PI * 2;
    return [Math.cos(angle) * 100, Math.sin(angle) * 100] as const;
  });
  const kept = handleIndices(circle);
  assert.equal(kept.length, 32);
  assert.deepEqual(
    kept.map((index) => circle[index]),
    simplifyRing(circle),
  );
  const moved = moveRingPoint(circle, kept[3] ?? 0, { x: 0, y: 0 });
  const unchanged = moved.filter((point, index) => point === circle[index]);
  assert.equal(unchanged.length, 79);
});
