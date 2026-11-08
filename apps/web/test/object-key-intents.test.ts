import assert from "node:assert/strict";
import { test } from "node:test";
import { objectStepOf } from "../src/screens/review/object-keys.ts";

test("the next and previous object actions step forward and back through intents", () => {
  assert.equal(objectStepOf("dnext"), 1);
  assert.equal(objectStepOf("dprev"), -1);
  assert.equal(objectStepOf("other"), null);
});
