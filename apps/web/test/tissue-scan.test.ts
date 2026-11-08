import assert from "node:assert/strict";
import { test } from "node:test";
import type { Scan } from "@parfocal/ui/lib/systematic-scan";
import { scanDone } from "@parfocal/ui/lib/systematic-scan";
import {
  cellsInArea,
  coverageGrid,
  coverageShare,
  emptyCoverage,
  markCells,
  viewArea,
} from "@parfocal/viewer-engine";
import {
  nextScan,
  type ScanTissue,
  scanFieldAt,
  tissueScanPath,
} from "../src/viewer/tissue-scan.ts";

function tissueFrom(rows: readonly string[], cell = 64): ScanTissue {
  const grid = { cell, columns: rows[0]?.length ?? 0, rows: rows.length };
  const tissue = new Uint8Array(Math.ceil((grid.columns * grid.rows) / 8));
  rows.forEach((line, row) => {
    line.split("").forEach((mark, column) => {
      const index = row * grid.columns + column;
      if (mark === "#") tissue[index >> 3] = (tissue[index >> 3] ?? 0) | (1 << (index & 7));
    });
  });
  return { grid, tissue };
}

const fixtureRows = [
  "####............",
  "####............",
  "####............",
  "###.............",
  "................",
  "###.............",
  "######..........",
  "################",
  "################",
  "################",
  "################",
  "################",
];

function runScan(tissue: ScanTissue, viewport: { width: number; height: number }, zoom: number) {
  const raster = emptyCoverage(tissue.grid);
  let scan: Scan | null = null;
  let steps = 0;
  do {
    const moved = nextScan(scan, tissue, viewport, zoom);
    scan = moved.scan;
    assert.ok(moved.camera);
    markCells(raster, cellsInArea(tissue.grid, viewArea(moved.camera, viewport)));
    steps += 1;
  } while (!scanDone(scan) && steps < 10_000);
  return { scan, steps, share: coverageShare(raster, tissue) };
}

test("stepping the scan on the stored mask of the dev slide reaches full tissue coverage", () => {
  const tissue = tissueFrom(fixtureRows);
  assert.deepEqual(tissue.grid, coverageGrid({ width: 1024, height: 768 }));
  const { scan, steps, share } = runScan(tissue, { width: 300, height: 220 }, -1);
  assert.equal(scan?.path.length, steps);
  assert.ok(steps > 2);
  assert.equal(share.basis, "tissue");
  assert.equal(share.seen, share.of);
  assert.equal(share.of, 104);
});

test("fields without a tissue centre are skipped", () => {
  const tissue = tissueFrom(["#.......", "........", "........", ".......#"]);
  const path = tissueScanPath(tissue, { width: 128, height: 128 });
  assert.deepEqual(
    path.map((field) => [field.column, field.row]),
    [
      [0, 0],
      [3, 1],
    ],
  );
});

test("the path is serpentine, left to right on even rows and right to left on odd rows", () => {
  const tissue = tissueFrom(["####", "####", "####"]);
  const path = tissueScanPath(tissue, { width: 128, height: 64 });
  assert.deepEqual(
    path.map((field) => [field.column, field.row]),
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
      [0, 2],
      [1, 2],
    ],
  );
  assert.deepEqual(
    path.map((field) => field.index),
    [0, 1, 2, 3, 4, 5],
  );
});

test("each step of the serpentine path starts within one field of the last", () => {
  const tissue = tissueFrom(fixtureRows);
  const path = tissueScanPath(tissue, { width: 128, height: 128 });
  for (let at = 1; at < path.length; at += 1) {
    const before = path[at - 1];
    const here = path[at];
    assert.ok(before && here);
    assert.ok(Math.abs(here.row - before.row) <= 1);
  }
});

test("the field follows the real viewport at the scan zoom with a small overlap", () => {
  const field = scanFieldAt({ width: 1000, height: 600 }, -2);
  assert.equal(field.width, 3800);
  assert.equal(field.height, 2280);
});

test("an empty mask gives no path", () => {
  assert.deepEqual(tissueScanPath(tissueFrom(["....", "...."]), { width: 64, height: 64 }), []);
});

test("a full size grid with odd fields still covers every tissue cell", () => {
  const columns = 1000;
  const rows = 700;
  const lines = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) =>
      ((column - 500) / 420) ** 2 + ((row - 350) / 300) ** 2 < 1 ||
      (column * 7 + row * 13) % 997 === 0
        ? "#"
        : ".",
    ).join(""),
  );
  const tissue = tissueFrom(lines, 128);
  const { share, steps } = runScan(tissue, { width: 1333, height: 777 }, -2.3);
  assert.ok(steps > 50);
  assert.equal(share.seen, share.of);
});
