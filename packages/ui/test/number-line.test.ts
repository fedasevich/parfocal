import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerCells,
  classCount,
  type NumberLineClass,
  numberLineLabel,
  numberLineTotals,
} from "../src/lib/number-line.ts";

const seeded: NumberLineClass[] = [
  { name: "Tumor", color: "#f87171", sure: 11190, unsure: 14, checked: 30 },
  { name: "Stroma", color: "#6ee7b7", sure: 4300, unsure: 10, checked: 0 },
  { name: "Immune", color: "#c084fc", sure: 2290, unsure: 0, checked: 5 },
];

test("checked, sure and unsure add up to the total", () => {
  const totals = numberLineTotals(seeded);
  assert.equal(
    totals.total,
    seeded.reduce((sum, row) => sum + classCount(row), 0),
  );
  assert.equal(totals.checked + totals.sure + totals.unsure, totals.total);
  assert.deepEqual(totals, { total: 17804, checked: 35, sure: 17745, unsure: 24 });
});

test("every answer moves a cell from unsure to checked and keeps the total", () => {
  const before = numberLineTotals(seeded);
  const after = numberLineTotals(answerCells(seeded, "Tumor"));
  assert.equal(after.total, before.total);
  assert.equal(after.unsure, before.unsure - 1);
  assert.equal(after.checked, before.checked + 1);
  assert.equal(after.sure, before.sure);
  assert.equal(after.checked + after.sure + after.unsure, after.total);
});

test("answers stop at the unsure cells a class has", () => {
  assert.deepEqual(answerCells(seeded, "Immune", 3)[2], seeded[2]);
  const drained = answerCells(seeded, "Stroma", 99);
  assert.equal(drained[1]?.unsure, 0);
  assert.equal(numberLineTotals(drained).total, numberLineTotals(seeded).total);
});

test("all unsure, all checked and empty states add up", () => {
  const allUnsure = [{ name: "A", color: "#000", sure: 0, unsure: 7, checked: 0 }];
  assert.deepEqual(numberLineTotals(allUnsure), { total: 7, checked: 0, sure: 0, unsure: 7 });
  const allChecked = [{ name: "A", color: "#000", sure: 7, unsure: 0, checked: 7 }];
  assert.deepEqual(numberLineTotals(allChecked), { total: 7, checked: 7, sure: 0, unsure: 0 });
  assert.deepEqual(numberLineTotals([]), { total: 0, checked: 0, sure: 0, unsure: 0 });
});

test("the label names the three parts", () => {
  assert.equal(
    numberLineLabel(numberLineTotals(seeded)),
    "17804 cells: 35 checked by you, 17745 sure, 24 unsure",
  );
});
