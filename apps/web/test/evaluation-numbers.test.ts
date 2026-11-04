import assert from "node:assert/strict";
import { test } from "node:test";
import type { Evaluation } from "@parfocal/api-client";
import { comparisonRows, opinionRows, reasonRows } from "../src/screens/evaluation/numbers.ts";

const evaluation = {
  reasons: [
    ["artefact", 3],
    ["wrong_class", 9],
    ["boundary_off", 3],
    ["not_class", 5],
  ],
  opinions: [{ counts: { "5": 2, "10": 1, "1": 4 } }],
} as unknown as Evaluation;

test("disagreement reasons are sorted by size, largest first, ties by name", () => {
  assert.deepEqual(
    reasonRows(evaluation).map((row) => [row.label, row.count]),
    [
      ["Wrong cell type", 9],
      ["Not tumor", 5],
      ["Artefact or fold", 3],
      ["Boundary is off", 3],
    ],
  );
});

test("opinion answers run in score order", () => {
  assert.deepEqual(
    opinionRows(evaluation).map((row) => row.count),
    [4, 2, 1],
  );
});

const withNumbers = (sensitivity: number, cells: number, disagree: number) =>
  ({
    overall: [{ kind: "region", sensitivity: { value: sensitivity }, precision: { value: 0.9 } }],
    dice: { Tumor: { value: 0.8 } },
    mean_kappa: 0.7,
    cell_agreement_with_ai: { value: cells },
    decisions: { counted: { disagree } },
  }) as unknown as Evaluation;

test("a comparison lists each measure for both tasks with the change", () => {
  const rows = comparisonRows(withNumbers(0.92, 0.91, 10), withNumbers(0.84, 0.87, 12));
  assert.deepEqual(rows[0], {
    label: "Sensitivity, regions",
    left: "0.92",
    right: "0.84",
    change: "-0.08",
  });
  assert.equal(rows[1]?.change, "same");
  const cells = rows.find((row) => row.label === "Cells agreed");
  assert.deepEqual([cells?.left, cells?.right, cells?.change], ["91%", "87%", "-4 points"]);
  assert.equal(rows.at(-1)?.change, "+2");
});
