import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCullGrid,
  cameraViewRect,
  cullCellCount as cellCount,
  cellsIn,
  containsCells,
  cullCellDiameters,
  cullWindow,
  cullWindowPadCells,
  type PointBatch,
  pointSubset,
  polygonBatchFromRings,
  polygonSubset,
  rangeTotal,
  rowRanges,
  slideToScreen,
  triangleStarts,
  triangulatePolygons,
  type ViewRect,
  windowMembers,
} from "../../src/index.ts";

const diameter = 5;
const cell = diameter * cullCellDiameters;

function lattice(columns: number, rows: number, pitch: number): PointBatch {
  const count = columns * rows;
  const positions = new Float32Array(count * 2);
  const colors = new Uint8Array(count * 4);
  for (let point = 0; point < count; point++) {
    positions[point * 2] = (point % columns) * pitch;
    positions[point * 2 + 1] = Math.floor(point / columns) * pitch;
    colors[point * 4] = point % 251;
    colors[point * 4 + 3] = 255;
  }
  return { count, positions, colors };
}

function inside(points: PointBatch, rect: ViewRect): number[] {
  const found: number[] = [];
  for (let point = 0; point < points.count; point++) {
    const x = points.positions[point * 2] ?? 0;
    const y = points.positions[point * 2 + 1] ?? 0;
    if (x >= rect[0] && x <= rect[2] && y >= rect[1] && y <= rect[3]) found.push(point);
  }
  return found;
}

test("cells are 16 median nucleus diameters wide", () => {
  const grid = buildCullGrid(lattice(100, 100, 10), diameter, 0);
  assert.equal(cullCellDiameters, 16);
  assert.equal(grid.cell, cell);
  assert.equal(grid.columns, Math.floor(990 / cell) + 1);
  assert.equal(grid.rows, grid.columns);
});

test("every point lands in exactly one cell and the order groups points by cell", () => {
  const points = lattice(100, 100, 10);
  const grid = buildCullGrid(points, diameter, 0);
  assert.equal(grid.cellStarts[grid.columns * grid.rows], points.count);
  assert.deepEqual(
    [...grid.order].sort((a, b) => a - b),
    [...Array(points.count).keys()],
  );
  for (let key = 0; key < grid.columns * grid.rows; key++) {
    const column = key % grid.columns;
    const row = Math.floor(key / grid.columns);
    for (let at = grid.cellStarts[key] ?? 0; at < (grid.cellStarts[key + 1] ?? 0); at++) {
      const point = grid.order[at] ?? 0;
      assert.equal(Math.floor((points.positions[point * 2] ?? 0) / cell), column);
      assert.equal(Math.floor((points.positions[point * 2 + 1] ?? 0) / cell), row);
    }
  }
});

test("a huge layer doubles the cell until the grid fits the cell cap", () => {
  const points: PointBatch = {
    count: 2,
    positions: new Float32Array([0, 0, 1_000_000, 1_000_000]),
    colors: new Uint8Array(8),
  };
  const grid = buildCullGrid(points, 1, 0);
  assert.ok(grid.columns * grid.rows <= 1 << 18);
  assert.equal(Math.log2(grid.cell / cullCellDiameters) % 1, 0);
  assert.ok(grid.cell > cullCellDiameters);
});

test("an empty layer builds a one cell grid with nothing in it", () => {
  const grid = buildCullGrid(
    { count: 0, positions: new Float32Array(0), colors: new Uint8Array(0) },
    diameter,
    0,
  );
  assert.equal(grid.columns * grid.rows, 1);
  assert.equal(windowMembers(grid, cellsIn(grid, [0, 0, 10, 10])).length, 0);
});

test("the cells of a view cover it, clamp to the grid and are null off the grid", () => {
  const grid = buildCullGrid(lattice(100, 100, 10), diameter, 0);
  assert.deepEqual(cellsIn(grid, [100, 170, 250, 330]), { x0: 1, y0: 2, x1: 3, y1: 4 });
  assert.deepEqual(cellsIn(grid, [-500, -500, 90, 90], 1), { x0: 0, y0: 0, x1: 2, y1: 2 });
  assert.equal(cellsIn(grid, [2000, 0, 2100, 100]), null);
  assert.equal(cellsIn(grid, [-300, 0, -200, 100]), null);
  assert.equal(cellsIn(grid, [Number.NaN, 0, 1, 1]), null);
});

test("the margin widens the view by the reach of a shape around its centre", () => {
  const points = lattice(100, 100, 10);
  const plain = buildCullGrid(points, diameter, 0);
  const reaching = buildCullGrid(points, diameter, 15);
  assert.deepEqual(cellsIn(plain, [165, 165, 230, 230]), { x0: 2, y0: 2, x1: 2, y1: 2 });
  assert.deepEqual(cellsIn(reaching, [165, 165, 230, 230]), { x0: 1, y0: 1, x1: 3, y1: 3 });
});

test("each row of cells is one contiguous range and touching rows merge", () => {
  const points = lattice(100, 100, 10);
  const grid = buildCullGrid(points, diameter, 0);
  const cells = { x0: 2, y0: 3, x1: 5, y1: 6 };
  const ranges = rowRanges(grid, cells);
  assert.equal(ranges.length, 8);
  assert.equal(rangeTotal(ranges), 32 * 32);
  const whole = rowRanges(grid, { x0: 0, y0: 0, x1: grid.columns - 1, y1: grid.rows - 1 });
  assert.deepEqual(whole, [0, points.count]);
  assert.deepEqual(rowRanges(grid, null), []);
});

test("the window holds every point of the view, in the original order", () => {
  const points = lattice(100, 100, 10);
  const grid = buildCullGrid(points, diameter, 0);
  const view: ViewRect = [205, 300, 395, 470];
  const members = windowMembers(grid, cellsIn(grid, view));
  const held = new Set(members);
  for (const point of inside(points, view)) assert.ok(held.has(point));
  assert.deepEqual(
    [...members],
    [...members].sort((a, b) => a - b),
  );
  assert.equal(members.length, 3 * 3 * 64);
});

test("the window is 2 cells wider than the view on every side", () => {
  const grid = buildCullGrid(lattice(200, 200, 10), diameter, 0);
  const view: ViewRect = [810, 810, 950, 950];
  assert.equal(cullWindowPadCells, 2);
  assert.deepEqual(cellsIn(grid, view), { x0: 10, y0: 10, x1: 11, y1: 11 });
  assert.deepEqual(cullWindow(grid, view, undefined), { x0: 8, y0: 8, x1: 13, y1: 13 });
});

test("a pan inside the window keeps it and a pan out of it makes a new one", () => {
  const grid = buildCullGrid(lattice(200, 200, 10), diameter, 0);
  const first = cullWindow(grid, [810, 810, 950, 950], undefined);
  assert.ok(first);
  const near = cullWindow(grid, [960, 700, 1100, 840], first);
  assert.equal(near, first);
  const far = cullWindow(grid, [1130, 810, 1270, 950], first);
  assert.notEqual(far, first);
  assert.deepEqual(far, { x0: 12, y0: 8, x1: 17, y1: 13 });
  const seen = cellsIn(grid, [1130, 810, 1270, 950]);
  assert.ok(far && seen && containsCells(far, seen));
});

test("zooming in far enough shrinks a window that is over twice what the view needs", () => {
  const grid = buildCullGrid(lattice(200, 200, 10), diameter, 0);
  const wide = cullWindow(grid, [400, 400, 1190, 1190], undefined);
  assert.equal(cellCount(wide), 14 * 14);
  const slightlyCloser = cullWindow(grid, [480, 480, 1110, 1110], wide);
  assert.equal(slightlyCloser, wide);
  const close = cullWindow(grid, [810, 810, 950, 950], wide);
  assert.equal(cellCount(close), 6 * 6);
});

test("a view off the layer has no window and coming back makes one", () => {
  const grid = buildCullGrid(lattice(100, 100, 10), diameter, 0);
  assert.equal(cullWindow(grid, [5000, 5000, 5100, 5100], undefined), null);
  assert.ok(cullWindow(grid, [100, 100, 200, 200], null));
  assert.equal(cellCount(null), 0);
});

const polygons = polygonBatchFromRings([
  { ring: [0, 0, 4, 0, 4, 4, 0, 4], color: [1, 2, 3, 4] },
  { ring: [10, 10, 11, 10], color: [5, 6, 7, 8] },
  {
    ring: [20, 20, 40, 20, 40, 40, 20, 40],
    holes: [[25, 25, 35, 25, 35, 35, 25, 35]],
    color: [9, 10, 11, 12],
  },
  { ring: [50, 50, 56, 50, 53, 56], color: [13, 14, 15, 16] },
  { ring: [60, 60, 64, 60, 66, 63, 64, 66, 60, 66], color: [17, 18, 19, 20] },
]);

test("triangle starts give each polygon its own range of the indices", () => {
  const starts = triangleStarts(polygons);
  assert.equal(starts[0], 0);
  assert.equal(starts[polygons.count], polygons.indices.length);
  assert.equal(starts[2], starts[1]);
  for (let shape = 0; shape < polygons.count; shape++) {
    const from = polygons.starts[shape] ?? 0;
    const to = polygons.starts[shape + 1] ?? 0;
    for (let at = starts[shape] ?? 0; at < (starts[shape + 1] ?? 0); at++) {
      const index = polygons.indices[at] ?? -1;
      assert.ok(index >= from && index < to);
    }
  }
});

test("a subset of polygons keeps vertices, colours, holes and triangles without earcut", () => {
  const picked = Uint32Array.of(2, 4);
  const subset = polygonSubset(polygons, triangleStarts(polygons), picked);
  assert.equal(subset.count, 2);
  assert.deepEqual([...subset.starts], [0, 8, 13]);
  assert.deepEqual([...subset.holeStarts], [4]);
  assert.deepEqual([...subset.colors], [9, 10, 11, 12, 17, 18, 19, 20]);
  assert.deepEqual([...subset.positions.subarray(0, 4)], [20, 20, 40, 20]);
  assert.deepEqual([...subset.positions.subarray(16, 20)], [60, 60, 64, 60]);
  assert.deepEqual(
    [...subset.indices],
    [...triangulatePolygons(subset.positions, subset.starts, subset.holeStarts)],
  );
});

test("an empty subset is an empty batch", () => {
  const subset = polygonSubset(polygons, triangleStarts(polygons), new Uint32Array(0));
  assert.equal(subset.count, 0);
  assert.deepEqual([...subset.starts], [0]);
  assert.equal(subset.indices.length, 0);
});

test("a subset of points keeps positions and colours", () => {
  const points = lattice(10, 10, 10);
  const subset = pointSubset(points, Uint32Array.of(3, 57));
  assert.equal(subset.count, 2);
  assert.deepEqual([...subset.positions], [30, 0, 70, 50]);
  assert.deepEqual([...subset.colors], [3, 0, 0, 255, 57, 0, 0, 255]);
});

test("the view of a camera is the slide rectangle its canvas shows", () => {
  const camera = { x: 5000, y: 3000, zoom: -2 };
  const view = cameraViewRect(camera, 800, 600);
  assert.deepEqual(view, [5000 - 1600, 3000 - 1200, 5000 + 1600, 3000 + 1200]);
  const screen = { left: 0, top: 0, width: 800, height: 600 };
  assert.deepEqual(slideToScreen(camera, screen, { x: view?.[0] ?? 0, y: view?.[1] ?? 0 }), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(slideToScreen(camera, screen, { x: view?.[2] ?? 0, y: view?.[3] ?? 0 }), {
    x: 800,
    y: 600,
  });
  assert.equal(cameraViewRect(camera, 0, 600), undefined);
});

test("a camera pan of a few screens moves the window and a small one keeps it", () => {
  const grid = buildCullGrid(lattice(400, 400, 10), diameter, 0);
  const at = (x: number, y: number) => cameraViewRect({ x, y, zoom: 1 }, 800, 600);
  const first = cullWindow(grid, at(2000, 2000) ?? [0, 0, 0, 0], undefined);
  assert.ok(first && cellCount(first) < grid.columns * grid.rows);
  assert.equal(cullWindow(grid, at(2050, 2030) ?? [0, 0, 0, 0], first), first);
  assert.notEqual(cullWindow(grid, at(3200, 2000) ?? [0, 0, 0, 0], first), first);
});
