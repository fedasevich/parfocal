import assert from "node:assert/strict";
import { test } from "node:test";
import { minutesLeft, slidePosition } from "../src/screens/my-work/review-progress.ts";

test("no time estimate shows before a slide is reviewed", () => {
  assert.equal(minutesLeft(0, 13), null);
});

test("the estimate counts the slides still to review", () => {
  assert.equal(minutesLeft(3, 13), 160);
});

test("the estimate never goes negative", () => {
  assert.equal(minutesLeft(5, 4), 0);
});

test("the slide position is one based", () => {
  assert.equal(slidePosition(1, 13), 2);
});

test("the slide position never passes the number of slides", () => {
  assert.equal(slidePosition(1, 1), 1);
});
