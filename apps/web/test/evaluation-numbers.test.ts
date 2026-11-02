import assert from "node:assert/strict";
import { test } from "node:test";
import type { Evaluation } from "@parfocal/api-client";
import { opinionRows, reasonRows } from "../src/screens/evaluation/numbers.ts";

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
