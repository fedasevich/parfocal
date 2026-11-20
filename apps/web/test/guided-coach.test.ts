import assert from "node:assert/strict";
import { test } from "node:test";
import { coachShown } from "../src/screens/review/guided-coach.ts";

test("the tips wait for a slide with AI objects to point at", () => {
  assert.equal(coachShown(true, 0, true), false);
  assert.equal(coachShown(true, 3, true), true);
  assert.equal(coachShown(false, 3, true), false);
});

test("read only review never coaches the person to answer", () => {
  assert.equal(coachShown(true, 3, false), false);
});
