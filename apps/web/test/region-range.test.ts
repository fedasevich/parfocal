import assert from "node:assert/strict";
import { test } from "node:test";
import { regionRange } from "../src/screens/review/region-range.ts";

test("no regions give no range instead of an infinite one", () => {
  assert.deepEqual(regionRange([], "auto"), { kind: "none" });
});

test("regions without a known size give a count and no range", () => {
  assert.deepEqual(regionRange([null, undefined], "auto"), { kind: "unknown", count: 2 });
});

test("the range runs from the smallest to the largest known size", () => {
  assert.deepEqual(regionRange([2.4, 0.012, null], "auto"), {
    kind: "range",
    count: 3,
    low: "12.0 µm",
    high: "2.4 mm",
  });
  assert.deepEqual(regionRange([0.45, 0.45], "auto"), { kind: "one", count: 2, size: "450 µm" });
  assert.deepEqual(regionRange([1.5, 0.45], "um"), {
    kind: "range",
    count: 2,
    low: "450 µm",
    high: "1500 µm",
  });
});
