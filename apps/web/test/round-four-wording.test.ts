import assert from "node:assert/strict";
import { test } from "node:test";
import { slidesTimeLeft } from "../src/screens/review/slides-time-left.ts";
import { readOnlyCodeOf } from "../src/viewer/viewer-access.ts";

test("the last or only slide of a review reads Last slide, never about 0 min left", () => {
  assert.equal(slidesTimeLeft(1, 1), "Last slide");
  assert.equal(slidesTimeLeft(12, 12), "Last slide");
  assert.equal(slidesTimeLeft(11, 12), "about 20 min left");
  assert.equal(slidesTimeLeft(8, 12), "about 1 h 20 min left");
  assert.equal(slidesTimeLeft(9, 12), "about 1 h left");
});

test("the banner of a task you are not assigned to uses its own notice, not a refusal", () => {
  assert.equal(
    readOnlyCodeOf({ kind: "read-only", reason: "not-assigned" }),
    "not-assigned-notice",
  );
  assert.equal(readOnlyCodeOf({ kind: "read-only", reason: "withdrawn" }), "task-withdrawn");
});
