import assert from "node:assert/strict";
import { test } from "node:test";
import { summaryOf } from "../src/screens/project/result-set-summary.ts";

const counted = (fields: Partial<Parameters<typeof summaryOf>[0]> = {}) =>
  summaryOf({
    status: "ready",
    error_code: null,
    cell_count: 0,
    region_count: 0,
    zone_count: 0,
    ...fields,
  });

test("a nuclei run counts its cells and leaves out regions it never makes", () => {
  assert.deepEqual(counted({ cell_count: 2428 }), {
    kind: "objects",
    cells: 2428,
    regions: 0,
    zones: 0,
  });
});

test("an empty run says why it is empty", () => {
  assert.deepEqual(counted({ error_code: "run-found-no-tissue" }), {
    kind: "empty",
    reason: "no-tissue",
  });
  assert.deepEqual(counted({ error_code: "run-found-nothing" }), {
    kind: "empty",
    reason: "nothing-found",
  });
  assert.deepEqual(counted(), { kind: "empty", reason: "unknown" });
});

test("a failed or unfinished set shows its state, not a count", () => {
  assert.deepEqual(counted({ status: "failed", error_code: "run-objects-lost" }), {
    kind: "failed",
    code: "run-objects-lost",
  });
  assert.deepEqual(counted({ status: "importing" }), { kind: "importing" });
});
