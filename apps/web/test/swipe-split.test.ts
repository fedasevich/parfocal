import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clampSplit,
  splitAfterKey,
  splitFromPointer,
  splitPercent,
  swipeStart,
} from "../src/screens/viewer/swipe-split.ts";

test("a pointer position becomes a share of the width and stays inside the slide", () => {
  assert.equal(splitFromPointer(300, 100, 400), 0.5);
  assert.equal(splitFromPointer(-50, 100, 400), 0.04);
  assert.equal(splitFromPointer(900, 100, 400), 0.96);
  assert.equal(splitFromPointer(300, 100, 0), swipeStart);
});

test("arrow keys nudge the line, shift takes bigger steps and Home and End jump to the edges", () => {
  assert.equal(splitPercent(splitAfterKey(0.5, "ArrowRight", false) ?? 0), 52);
  assert.equal(splitPercent(splitAfterKey(0.5, "ArrowLeft", true) ?? 0), 40);
  assert.equal(splitAfterKey(0.5, "Home", false), 0.04);
  assert.equal(splitAfterKey(0.5, "End", false), 0.96);
  assert.equal(splitAfterKey(0.5, "a", false), null);
  assert.equal(clampSplit(Number.NaN), swipeStart);
});
