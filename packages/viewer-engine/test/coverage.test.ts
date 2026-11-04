import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Camera,
  type CoverageRaster,
  type CoverageTimers,
  cellsInArea,
  coverageGrid,
  coveragePercent,
  coverageShare,
  createCoverageTracker,
  decodeBits,
  emptyCoverage,
  encodeBits,
  isSeen,
  markCells,
  mergeCoverage,
  seesCoverage,
  tissueOnGrid,
  viewArea,
  zoomForMagnification,
} from "../src/index.ts";

const slide = { width: 8192, height: 4096 };
const micronsPerPixel = 0.25;
const viewport = { width: 512, height: 256 };
const atTen = zoomForMagnification(micronsPerPixel, 10);
const atFive = zoomForMagnification(micronsPerPixel, 5);
const grid = coverageGrid(slide);

const panPath: Camera[] = [
  { x: 1024, y: 512, zoom: atTen },
  { x: 2048, y: 512, zoom: atTen },
  { x: 3072, y: 512, zoom: atTen },
  { x: 6000, y: 3000, zoom: atFive },
  { x: 3072, y: 512, zoom: atTen + 1 },
];

const tissue = tissueOnGrid(grid, { cell: 64, columns: 128, rows: 64 }, (column) => column < 64);

function manualTimers() {
  const due: { callback: () => void; ms: number }[] = [];
  const timers: CoverageTimers = {
    set: (callback, ms) => {
      const entry = { callback, ms };
      due.push(entry);
      return entry;
    },
    clear: (handle) => {
      const index = due.indexOf(handle as (typeof due)[number]);
      if (index >= 0) due.splice(index, 1);
    },
  };
  const fire = () => {
    for (const entry of due.splice(0)) entry.callback();
  };
  return { timers, due, fire };
}

function fakeServer() {
  const stored = emptyCoverage(grid);
  const batches: number[][] = [];
  return {
    stored,
    batches,
    send: (cells: readonly number[]): Promise<CoverageRaster> => {
      batches.push([...cells]);
      markCells(stored, cells);
      return Promise.resolve({
        grid,
        seen: decodeBits(encodeBits(stored.seen), stored.seen.length),
      });
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("the coverage grid keeps 64 pixel cells and caps the long side at 1024 cells", () => {
  assert.deepEqual(grid, { cell: 64, columns: 128, rows: 64 });
  assert.deepEqual(coverageGrid({ width: 100_000, height: 80_000 }), {
    cell: 128,
    columns: 782,
    rows: 625,
  });
  assert.deepEqual(coverageGrid({ width: 1, height: 1 }), { cell: 64, columns: 1, rows: 1 });
});

test("a view marks the cells whose centres it shows", () => {
  const area = viewArea({ x: 1024, y: 512, zoom: atTen }, viewport);
  assert.deepEqual(area, { x: 0, y: 0, width: 2048, height: 1024 });
  const cells = cellsInArea(grid, area);
  assert.equal(cells.length, 32 * 16);
  assert.equal(cells[0], 0);
  assert.equal(cells.at(-1), 15 * 128 + 31);
  assert.deepEqual(cellsInArea(grid, { x: -500, y: -500, width: 10, height: 10 }), []);
});

test("only views at 10x or more count as seen", () => {
  assert.equal(seesCoverage({ x: 0, y: 0, zoom: atTen }, micronsPerPixel), true);
  assert.equal(seesCoverage({ x: 0, y: 0, zoom: atFive }, micronsPerPixel), false);
  assert.equal(seesCoverage({ x: 0, y: 0, zoom: atTen }, null), false);
});

test("a scripted pan path gives the expected raster and percentage", () => {
  const server = fakeServer();
  const { timers } = manualTimers();
  const tracker = createCoverageTracker({ grid, micronsPerPixel, send: server.send, timers });
  const added = panPath.map((camera) => tracker.observe(camera, viewport));
  assert.deepEqual(added, [512, 256, 256, 0, 0]);
  const raster = tracker.raster();
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      assert.equal(isSeen(raster, column, row), row < 16 && column < 64, `${column},${row}`);
    }
  }
  assert.deepEqual(tracker.share(), { seen: 1024, of: 8192, share: 0.125, basis: "slide" });
  tracker.setTissue(tissue);
  const share = tracker.share();
  assert.deepEqual(share, { seen: 1024, of: 4096, share: 0.25, basis: "tissue" });
  assert.equal(coveragePercent(share), 25);
});

test("seen cells reach the server in batches and survive a reload", async () => {
  const server = fakeServer();
  const { timers, due, fire } = manualTimers();
  const tracker = createCoverageTracker({
    grid,
    micronsPerPixel,
    send: server.send,
    timers,
    batchLimit: 300,
  });
  let changes = 0;
  tracker.subscribe(() => {
    changes += 1;
  });
  for (const camera of panPath) tracker.observe(camera, viewport);
  assert.equal(server.batches.length, 0);
  assert.equal(due.length, 1);
  assert.equal(due[0]?.ms, 4000);
  assert.equal(tracker.pending(), 1024);
  fire();
  await settle();
  await tracker.flush();
  assert.deepEqual(
    server.batches.map((batch) => batch.length),
    [300, 300, 300, 124],
  );
  assert.equal(tracker.pending(), 0);
  assert.ok(changes >= 3);
  await tracker.dispose();

  const reloaded = createCoverageTracker({
    grid,
    micronsPerPixel,
    send: server.send,
    timers,
    initial: { grid, seen: decodeBits(encodeBits(server.stored.seen), server.stored.seen.length) },
    tissue,
  });
  assert.deepEqual(reloaded.share(), { seen: 1024, of: 4096, share: 0.25, basis: "tissue" });
  assert.equal(reloaded.observe(panPath[0] as Camera, viewport), 0);
});

test("a failed batch stays queued and goes again on the next flush", async () => {
  const server = fakeServer();
  const { timers } = manualTimers();
  let fail = true;
  const tracker = createCoverageTracker({
    grid,
    micronsPerPixel,
    timers,
    send: (cells) => (fail ? Promise.reject(new Error("offline")) : server.send(cells)),
  });
  tracker.observe(panPath[0] as Camera, viewport);
  await tracker.flush();
  assert.equal(tracker.pending(), 512);
  fail = false;
  await tracker.flush();
  assert.equal(tracker.pending(), 0);
  assert.equal(coverageShare(server.stored).seen, 512);
});

test("coverage from the server merges into the local raster", () => {
  const local = emptyCoverage(grid);
  markCells(local, [0, 1]);
  const other = emptyCoverage(grid);
  markCells(other, [1, 2, 8191]);
  assert.deepEqual(mergeCoverage(local, other), [2, 8191]);
  assert.deepEqual(mergeCoverage(local, emptyCoverage({ cell: 64, columns: 2, rows: 2 })), []);
});

test("bits round trip through base64", () => {
  for (const length of [0, 1, 2, 3, 4, 1024]) {
    const bits = Uint8Array.from({ length }, (_, index) => (index * 37 + 11) & 255);
    const text = encodeBits(bits);
    assert.equal(text, Buffer.from(bits).toString("base64"));
    assert.deepEqual(decodeBits(text, length), bits);
  }
});
