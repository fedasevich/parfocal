import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CountedCell,
  cellCountChipText,
  cellCountRange,
  cellCountResult,
  justSettled,
  settledToast,
} from "../src/lib/cell-count.ts";

const cluster = (agree: number, open: number[]): CountedCell[] => [
  ...Array.from({ length: agree }, () => ({ probability: 0.5, call: "agree" as const })),
  ...open.map((probability) => ({ probability, call: null })),
];

test("the range adds checked cells as sure and unchecked cells as the AI's own odds", () => {
  const range = cellCountRange(cluster(41, [0.5, 0.6]), 100);
  assert.equal(range.low, 100 + 41 + 1.1);
  assert.equal(range.high, 100 + 41 + 2);
});

test("a disagree takes the cell out of both ends", () => {
  const cells: CountedCell[] = [{ probability: 0.6, call: "disagree" }];
  assert.deepEqual(cellCountRange(cells, 100), { low: 100, high: 100 });
});

test("a count whose range crosses 200 is open and says how many cells to check", () => {
  const result = cellCountResult(cluster(0, [0.5, 0.5, 0.5]), 198);
  assert.equal(result.phase, "open");
  assert.equal(result.side, "either");
  assert.equal(result.toCheck, 2);
});

test("a count settles under 200 once the range top cannot pass 200", () => {
  const open = cluster(0, [0.5, 0.5, 0.5]);
  assert.equal(cellCountResult(open, 198).phase, "open");
  const afterOne = [{ probability: 0.5, call: "disagree" as const }, ...open.slice(1)];
  const result = cellCountResult(afterOne, 198);
  assert.equal(result.phase, "settled");
  assert.equal(result.side, "under");
  assert.equal(result.high, 200);
});

test("a count settles over 200 once the range bottom passes 200", () => {
  const result = cellCountResult(cluster(3, []), 198);
  assert.equal(result.phase, "settled");
  assert.equal(result.side, "over");
});

test("exactly 200 at the top is settled and 201 at the bottom is over", () => {
  assert.equal(cellCountResult([], 200).side, "under");
  assert.equal(cellCountResult([], 201).side, "over");
});

test("the toast fires only on the move from open to settled", () => {
  assert.equal(justSettled("open", "settled"), true);
  assert.equal(justSettled("settled", "settled"), false);
  assert.equal(justSettled(null, "settled"), false);
  assert.equal(justSettled("settled", "open"), false);
  assert.equal(settledToast, "You can stop here");
});

test("the chip names the range while open and the side once settled", () => {
  const open = cellCountResult(cluster(0, [0.5, 0.5]), 199);
  assert.equal(
    cellCountChipText(open),
    "About 200 to 201 tumor cells, could be either side of 200",
  );
  const settled = cellCountResult(cluster(2, []), 199);
  assert.equal(cellCountChipText(settled), "Over 200 tumor cells (201), settled");
});
