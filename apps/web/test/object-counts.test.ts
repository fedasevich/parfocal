import assert from "node:assert/strict";
import { test } from "node:test";
import { sampledCellsOf } from "../src/screens/review/object-counts.ts";

const objects = (regions: number, cells: number) => [
  ...Array.from({ length: regions }, () => ({ kind: "region" as const })),
  ...Array.from({ length: cells }, () => ({ kind: "cell" as const })),
];

test("the cell count follows the objects of each slide and is never a constant", () => {
  assert.equal(sampledCellsOf(objects(3, 12)), 12);
  assert.equal(sampledCellsOf(objects(1, 50)), 50);
  assert.equal(sampledCellsOf(objects(2, 0)), 0);
});
