import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CellSpot,
  jumpTarget,
  nearestOpen,
  panned,
  placeBar,
  previousOpen,
  touchesCircle,
} from "../src/screens/review/cell-jump.ts";

const cells: CellSpot[] = [
  { object: "A", x: 100, y: 100, decided: false },
  { object: "B", x: 140, y: 100, decided: true },
  { object: "C", x: 200, y: 105, decided: false },
  { object: "D", x: 100, y: 160, decided: true },
  { object: "E", x: 100, y: 30, decided: false },
];

test("an arrow jumps to the nearest cell that way and undecided cells come first", () => {
  assert.equal(jumpTarget(cells, "A", "right"), "C");
  assert.equal(jumpTarget(cells, "A", "up"), "E");
});

test("when every cell that way is decided the nearest one is chosen", () => {
  assert.equal(jumpTarget(cells, "A", "down"), "D");
});

test("no cell that way gives nothing", () => {
  assert.equal(jumpTarget(cells, "A", "left"), undefined);
  assert.equal(jumpTarget(cells, "Z", "left"), undefined);
});

test("a cell outside the cone is not a target", () => {
  const tilted: CellSpot[] = [
    { object: "A", x: 0, y: 0, decided: false },
    { object: "B", x: 10, y: 100, decided: false },
  ];
  assert.equal(jumpTarget(tilted, "A", "right"), undefined);
  assert.equal(jumpTarget(tilted, "A", "down"), "B");
});

test("the nearest open cell skips decided ones", () => {
  assert.equal(nearestOpen(cells, "A"), "E");
  const done = cells.map((cell) => ({ ...cell, decided: true }));
  assert.equal(nearestOpen(done, "A"), undefined);
});

test("the bar goes below the cell, above it near the bottom, and never touches it", () => {
  const size = { width: 1000, height: 700 };
  const bar = { width: 560, height: 48 };
  const middle = { x: 500, y: 350 };
  const lower = { x: 500, y: 640 };
  const corner = { x: 20, y: 20 };
  for (const cell of [middle, lower, corner]) {
    const box = placeBar(cell, 30, bar, size);
    assert.equal(touchesCircle(box, cell, 30), false);
    assert.ok(box.left >= 0 && box.left + box.width <= size.width);
  }
  assert.ok(placeBar(middle, 30, bar, size).top > middle.y);
  assert.ok(placeBar(lower, 30, bar, size).top < lower.y);
});

test("a jump reaches an undecided cell far away before a decided one close by", () => {
  const far: CellSpot[] = [
    { object: "A", x: 0, y: 0, decided: false },
    { object: "near", x: 30, y: 0, decided: true },
    { object: "far", x: 900, y: 40, decided: false },
  ];
  assert.equal(jumpTarget(far, "A", "right"), "far");
});

test("when every cell that way is decided the nearest decided one is the target", () => {
  const done = cells.map((cell) => ({ ...cell, decided: true }));
  assert.equal(jumpTarget(done, "A", "right"), "B");
});

test("with one cell on the slide no arrow goes anywhere", () => {
  const alone: CellSpot[] = [{ object: "A", x: 5, y: 5, decided: false }];
  for (const way of ["left", "right", "up", "down"] as const) {
    assert.equal(jumpTarget(alone, "A", way), undefined);
  }
});

test("two cells on the same spot are not each other's target", () => {
  const stacked: CellSpot[] = [
    { object: "A", x: 5, y: 5, decided: false },
    { object: "B", x: 5, y: 5, decided: false },
  ];
  assert.equal(jumpTarget(stacked, "A", "right"), undefined);
});

test("shift and an arrow pans the camera by a fixed screen distance", () => {
  const camera = { x: 100, y: 100, scale: 2 };
  assert.deepEqual(panned(camera, "right"), { x: 148, y: 100, scale: 2 });
  assert.deepEqual(panned(camera, "up"), { x: 100, y: 52, scale: 2 });
});

test("shift and J steps back through the open cells of a zone and wraps", () => {
  const order = ["a", "b", "c", "d"];
  const open = (object: string) => object !== "b";
  assert.equal(previousOpen(order, "c", open), "a");
  assert.equal(previousOpen(order, "a", open), "d");
  assert.equal(
    previousOpen(order, "a", () => false),
    undefined,
  );
  assert.equal(previousOpen(order, undefined, open), "d");
});
