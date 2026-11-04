import assert from "node:assert/strict";
import { test } from "node:test";
import {
  coverageGrid,
  coveragePercent,
  coverageShare,
  emptyCoverage,
  markCells,
} from "@parfocal/viewer-engine";
import { runCells, seenRuns } from "../src/viewer/seen-runs.ts";

const grid = coverageGrid({ width: 6400, height: 3200 });

test("the runs drawn in the peek add up to the cells the ring counts", () => {
  const raster = emptyCoverage(grid);
  const cells = [0, 1, 2, 9, 10, grid.columns, grid.columns + 1, grid.columns * 3 - 1];
  markCells(raster, cells);
  const runs = seenRuns(raster);
  assert.equal(runCells(runs), cells.length);
  assert.equal(runCells(runs), coverageShare(raster).seen);
  assert.deepEqual(runs[0], { row: 0, start: 0, length: 3 });
  assert.deepEqual(runs[1], { row: 0, start: 9, length: 2 });
  assert.deepEqual(runs.at(-1), { row: 2, start: grid.columns - 1, length: 1 });
});

test("the ring percent is the runs over all cells of the slide", () => {
  const raster = emptyCoverage(grid);
  const total = grid.columns * grid.rows;
  markCells(
    raster,
    Array.from({ length: Math.floor(total / 4) }, (_, index) => index),
  );
  const share = coverageShare(raster);
  const cells = runCells(seenRuns(raster));
  assert.equal(cells, share.seen);
  assert.equal(coveragePercent(share), Math.round((100 * cells) / total));
});

test("an empty raster has no runs", () => {
  assert.deepEqual(seenRuns(emptyCoverage(grid)), []);
});
