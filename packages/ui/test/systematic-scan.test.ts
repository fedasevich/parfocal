import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceScan,
  currentField,
  overlap,
  scanCoverage,
  scanDone,
  scanPath,
  scanSummary,
  startScan,
  type TissueMask,
  tissueBoxes,
} from "../src/lib/systematic-scan.ts";

const mask: TissueMask = {
  cell: 10,
  rows: ["........", "..###...", ".#####..", "..##....", "........", "......##", "......##"],
};

const field = { width: 25, height: 15 };

test("the path covers every part of the tissue mask", () => {
  const path = scanPath(mask, field);
  for (const cell of tissueBoxes(mask)) {
    const covered = path.reduce((sum, box) => sum + overlap(cell, box), 0);
    assert.equal(covered, cell.width * cell.height, `tissue at ${cell.x},${cell.y}`);
  }
  assert.equal(scanCoverage(mask, path, path.length), 1);
});

test("every field on the path touches tissue and fields never overlap", () => {
  const path = scanPath(mask, field);
  const tissue = tissueBoxes(mask);
  for (const box of path) assert.ok(tissue.some((cell) => overlap(cell, box) > 0));
  for (const [index, box] of path.entries())
    for (const other of path.slice(index + 1)) assert.equal(overlap(box, other), 0);
});

test("the path runs in reading order, left to right and then down", () => {
  const path = scanPath(mask, field);
  assert.ok(path.length > 1);
  for (const [index, box] of path.entries()) {
    assert.equal(box.index, index);
    const next = path[index + 1];
    if (!next) continue;
    assert.ok(next.row > box.row || (next.row === box.row && next.column > box.column));
  }
  assert.deepEqual(
    path.map((box) => [box.row, box.column]),
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 2],
      [3, 2],
    ],
  );
});

test("the scan advances one field per step and stops at the last field", () => {
  const path = scanPath(mask, field);
  let scan = startScan(path);
  assert.equal(currentField(scan), path[0]);
  let before = scanCoverage(mask, path, scan.step);
  for (let step = 2; step <= path.length; step += 1) {
    scan = advanceScan(scan);
    assert.equal(scan.step, step);
    assert.equal(currentField(scan), path[step - 1]);
    const after = scanCoverage(mask, path, scan.step);
    assert.ok(after > before);
    before = after;
  }
  assert.ok(scanDone(scan));
  assert.equal(advanceScan(scan).step, path.length);
  assert.deepEqual(scanSummary(mask, scan), {
    step: path.length,
    fields: path.length,
    coverage: 1,
  });
});

test("before the scan starts nothing is covered, and an empty mask has no path", () => {
  assert.equal(scanCoverage(mask, scanPath(mask, field), 0), 0);
  assert.equal(currentField(null), null);
  assert.equal(scanSummary(mask, null), null);
  const empty: TissueMask = { cell: 10, rows: ["....", "...."] };
  assert.deepEqual(scanPath(empty, field), []);
  assert.equal(startScan([]).step, 0);
  assert.equal(scanDone(startScan([])), false);
});
