import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CellEvidence,
  resultChipText,
  resultRangeText,
  sideOf,
  type TumorShareSettings,
  tumorShareCutoffFor,
  tumorShareResultFor,
  tumorShareResultForCase,
} from "../src/lib/tumor-share.ts";

const repeat = (count: number, cell: CellEvidence): CellEvidence[] =>
  Array.from({ length: count }, () => ({ ...cell }));

const docThirtyThree = (): CellEvidence[] => [
  ...repeat(128, { probability: 0.75, calledTumor: true }),
  ...repeat(272, { probability: 36 / 272, calledTumor: false }),
];

const nearTheCutoff = (): CellEvidence[] => [
  ...repeat(95, { probability: 0.75, calledTumor: true }),
  ...repeat(305, { probability: 0.125, calledTumor: false }),
];

const settings: TumorShareSettings = {
  tumor_share_cutoff: 20,
  tumor_share_result_sentinel_node: false,
  tumor_share_result_pannuke: true,
};

test("doc 33's card: 32% of 400 typed, between 24% and 41%", () => {
  const result = tumorShareResultFor(docThirtyThree(), 0.3);
  assert.ok(result);
  assert.equal(result.typed, 400);
  assert.equal(result.share, 0.32);
  assert.ok(Math.abs(result.low - 0.24) < 1e-9);
  assert.ok(Math.abs(result.high - 0.41) < 1e-9);
  assert.equal(
    resultRangeText(result),
    "Tumor cells: 32% of 400 typed. Counting its likely mistakes either way, between 24% and 41%.",
  );
});

test("a range that sits wholly over the cutoff stays above whatever the unsure cells are", () => {
  const result = tumorShareResultFor(docThirtyThree(), 0.2);
  assert.ok(result);
  assert.equal(result.side, "above");
  assert.equal(result.state, "firm");
  assert.equal(result.toCheck, 0);
  assert.equal(resultChipText(result), "Above 20% whatever the unsure cells are");
});

test("a range that holds the cutoff is open and says to check the unsure cells", () => {
  const result = tumorShareResultFor(docThirtyThree(), 0.3);
  assert.ok(result);
  assert.equal(result.side, "either");
  assert.equal(result.state, "open");
  assert.equal(resultChipText(result), "Could be either side of 30%, check the unsure cells");
});

test("a range wholly under the cutoff stays below it", () => {
  const cells = [
    ...repeat(20, { probability: 0.9, calledTumor: true }),
    ...repeat(380, { probability: 0.01, calledTumor: false }),
  ];
  const result = tumorShareResultFor(cells, 0.2);
  assert.ok(result);
  assert.equal(result.side, "below");
  assert.equal(result.state, "firm");
  assert.equal(resultChipText(result), "Below 20% whatever the unsure cells are");
});

test("the open chip at 20% uses the lab's wording", () => {
  const result = tumorShareResultFor(nearTheCutoff(), 0.2);
  assert.ok(result);
  assert.equal(result.side, "either");
  assert.equal(resultChipText(result), "Could be either side of 20%, check the unsure cells");
});

test("it names how many of the most contested cells should settle it", () => {
  const result = tumorShareResultFor(nearTheCutoff(), 0.2);
  assert.ok(result);
  assert.equal(result.toCheck, 35);
});

test("checking those cells and confirming them settles it on the right side", () => {
  const cells = nearTheCutoff();
  cells.slice(0, 35).forEach((cell) => {
    cell.checked = true;
  });
  const result = tumorShareResultFor(cells, 0.2);
  assert.ok(result);
  assert.equal(result.side, "above");
  assert.equal(result.state, "settled");
  assert.equal(result.toCheck, 0);
});

test("one cell short of that stays open", () => {
  const cells = nearTheCutoff();
  cells.slice(0, 34).forEach((cell) => {
    cell.checked = true;
  });
  const result = tumorShareResultFor(cells, 0.2);
  assert.ok(result);
  assert.equal(result.side, "either");
  assert.equal(result.toCheck, 1);
});

test("answers that overturn the tumor calls settle it below", () => {
  const cells = nearTheCutoff();
  cells.slice(0, 95).forEach((cell) => {
    cell.calledTumor = false;
    cell.checked = true;
  });
  const result = tumorShareResultFor(cells, 0.2);
  assert.ok(result);
  assert.equal(result.share, 0);
  assert.equal(result.side, "below");
  assert.equal(result.state, "settled");
});

test("sides are decided by the range ends, a range on the cutoff counts as above", () => {
  assert.equal(sideOf(0.2, 0.3, 0.2), "above");
  assert.equal(sideOf(0.1, 0.19, 0.2), "below");
  assert.equal(sideOf(0.1, 0.2, 0.2), "either");
});

test("no cells gives no result", () => {
  assert.equal(tumorShareResultFor([], 0.2), null);
});

test("the result is hidden for a sentinel node case", () => {
  assert.equal(tumorShareCutoffFor("sentinel-node", settings), null);
  assert.equal(tumorShareResultForCase("sentinel-node", settings, docThirtyThree()), null);
});

test("the result is shown for a cellularity case at the lab's cutoff", () => {
  assert.equal(tumorShareCutoffFor("pannuke", settings), 0.2);
  const result = tumorShareResultForCase("pannuke", settings, docThirtyThree());
  assert.ok(result);
  assert.equal(result.cutoff, 0.2);
  const stricter = tumorShareResultForCase(
    "pannuke",
    { ...settings, tumor_share_cutoff: 30 },
    docThirtyThree(),
  );
  assert.equal(stricter?.side, "either");
});

test("the lab can switch the result off for a cellularity case or on for sentinel nodes", () => {
  assert.equal(
    tumorShareResultForCase(
      "pannuke",
      { ...settings, tumor_share_result_pannuke: false },
      docThirtyThree(),
    ),
    null,
  );
  assert.ok(
    tumorShareResultForCase(
      "sentinel-node",
      { ...settings, tumor_share_result_sentinel_node: true },
      docThirtyThree(),
    ),
  );
});

test("a case with no classes never shows the result", () => {
  assert.equal(tumorShareResultForCase("none", settings, docThirtyThree()), null);
});
