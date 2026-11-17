import assert from "node:assert/strict";
import { test } from "node:test";
import { coachShown } from "../src/screens/review/guided-coach.ts";

test("the tips wait for a slide with AI objects to point at", () => {
  assert.equal(coachShown(true, 0), false);
  assert.equal(coachShown(true, 3), true);
  assert.equal(coachShown(false, 3), false);
});
