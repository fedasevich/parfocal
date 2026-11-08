import assert from "node:assert/strict";
import { test } from "node:test";
import { dragHeight, isNextCellSwipe, settleHeight } from "../src/lib/sheet-gesture.ts";

const pixels = { peek: 88, half: 420, full: 720 };

test("a slow drag settles on the nearest height", () => {
  assert.equal(settleHeight("peek", 300, 0.1, pixels), "half");
  assert.equal(settleHeight("full", 200, -0.1, pixels), "peek");
  assert.equal(settleHeight("half", 600, 0.1, pixels), "full");
});

test("a fast fling moves one height in its direction", () => {
  assert.equal(settleHeight("peek", 120, 1, pixels), "half");
  assert.equal(settleHeight("full", 700, -1, pixels), "half");
  assert.equal(settleHeight("full", 700, 1, pixels), "full");
});

test("the dragged height stays between peek and full", () => {
  assert.equal(dragHeight(420, 900, pixels), 720);
  assert.equal(dragHeight(420, -900, pixels), 88);
});

test("only a quick mostly horizontal swipe left goes to the next cell", () => {
  assert.equal(isNextCellSwipe(-120, 10, 200), true);
  assert.equal(isNextCellSwipe(120, 10, 200), false);
  assert.equal(isNextCellSwipe(-30, 0, 200), false);
  assert.equal(isNextCellSwipe(-120, 90, 200), false);
  assert.equal(isNextCellSwipe(-120, 10, 900), false);
});
