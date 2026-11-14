import type { PointBatch, PolygonBatch } from "./batch-types.ts";

export const cullCellDiameters = 16;
export const cullWindowPadCells = 2;
export const cullWindowMaxExcess = 2;

const cullMaxCells = 1 << 18;

export type ViewRect = readonly [minX: number, minY: number, maxX: number, maxY: number];

export interface CullGrid {
  readonly originX: number;
  readonly originY: number;
  readonly cell: number;
  readonly columns: number;
  readonly rows: number;
  readonly margin: number;
  readonly cellStarts: Uint32Array;
  readonly order: Uint32Array;
}

export interface CellRect {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export function buildCullGrid(points: PointBatch, diameter: number, margin: number): CullGrid {
  const { count, positions } = points;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let point = 0; point < count; point++) {
    const x = positions[point * 2] ?? 0;
    const y = positions[point * 2 + 1] ?? 0;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (count === 0) {
    minX = 0;
    minY = 0;
    maxX = 1;
    maxY = 1;
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  let cell = Math.max(1, diameter * cullCellDiameters);
  while ((Math.floor(spanX / cell) + 1) * (Math.floor(spanY / cell) + 1) > cullMaxCells) cell *= 2;
  const columns = Math.floor(spanX / cell) + 1;
  const rows = Math.floor(spanY / cell) + 1;

  const cellOf = new Uint32Array(count);
  const cellStarts = new Uint32Array(columns * rows + 1);
  for (let point = 0; point < count; point++) {
    const column = Math.min(columns - 1, Math.floor(((positions[point * 2] ?? 0) - minX) / cell));
    const row = Math.min(rows - 1, Math.floor(((positions[point * 2 + 1] ?? 0) - minY) / cell));
    const key = row * columns + column;
    cellOf[point] = key;
    cellStarts[key + 1] = (cellStarts[key + 1] ?? 0) + 1;
  }
  for (let key = 0; key < columns * rows; key++) {
    cellStarts[key + 1] = (cellStarts[key + 1] ?? 0) + (cellStarts[key] ?? 0);
  }
  const cursor = cellStarts.slice(0, columns * rows);
  const order = new Uint32Array(count);
  for (let point = 0; point < count; point++) {
    const key = cellOf[point] ?? 0;
    const at = cursor[key] ?? 0;
    order[at] = point;
    cursor[key] = at + 1;
  }
  return { originX: minX, originY: minY, cell, columns, rows, margin, cellStarts, order };
}

export function cellsIn(grid: CullGrid, rect: ViewRect, padCells = 0): CellRect | null {
  const { originX, originY, cell, margin, columns, rows } = grid;
  const x0 = Math.floor((rect[0] - margin - originX) / cell) - padCells;
  const y0 = Math.floor((rect[1] - margin - originY) / cell) - padCells;
  const x1 = Math.floor((rect[2] + margin - originX) / cell) + padCells;
  const y1 = Math.floor((rect[3] + margin - originY) / cell) + padCells;
  if (!(x1 >= 0 && y1 >= 0 && x0 < columns && y0 < rows)) return null;
  return {
    x0: Math.max(0, x0),
    y0: Math.max(0, y0),
    x1: Math.min(columns - 1, x1),
    y1: Math.min(rows - 1, y1),
  };
}

export function containsCells(outer: CellRect, inner: CellRect): boolean {
  return (
    inner.x0 >= outer.x0 && inner.y0 >= outer.y0 && inner.x1 <= outer.x1 && inner.y1 <= outer.y1
  );
}

export function cellCount(cells: CellRect | null): number {
  return cells === null ? 0 : (cells.x1 - cells.x0 + 1) * (cells.y1 - cells.y0 + 1);
}

export function sameCells(a: CellRect | null, b: CellRect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1;
}

export function cellsKey(cells: CellRect | null): string {
  return cells === null ? "none" : `${cells.x0},${cells.y0},${cells.x1},${cells.y1}`;
}

export function cullWindow(
  grid: CullGrid,
  rect: ViewRect,
  current: CellRect | null | undefined,
): CellRect | null {
  const wanted = cellsIn(grid, rect, cullWindowPadCells);
  if (current === undefined || current === null || wanted === null) return wanted;
  const seen = cellsIn(grid, rect);
  if (seen === null || !containsCells(current, seen)) return wanted;
  return cellCount(current) > cellCount(wanted) * cullWindowMaxExcess ? wanted : current;
}

export function rowRanges(grid: CullGrid, cells: CellRect | null): number[] {
  const ranges: number[] = [];
  if (cells === null) return ranges;
  for (let row = cells.y0; row <= cells.y1; row++) {
    const from = grid.cellStarts[row * grid.columns + cells.x0] ?? 0;
    const to = grid.cellStarts[row * grid.columns + cells.x1 + 1] ?? 0;
    if (to <= from) continue;
    const last = ranges.length - 1;
    if (last > 0 && ranges[last] === from) ranges[last] = to;
    else ranges.push(from, to);
  }
  return ranges;
}

export function rangeTotal(ranges: readonly number[]): number {
  let total = 0;
  for (let at = 0; at < ranges.length; at += 2) total += (ranges[at + 1] ?? 0) - (ranges[at] ?? 0);
  return total;
}

export function windowMembers(grid: CullGrid, cells: CellRect | null): Uint32Array {
  const ranges = rowRanges(grid, cells);
  const members = new Uint32Array(rangeTotal(ranges));
  let cursor = 0;
  for (let at = 0; at < ranges.length; at += 2) {
    const from = ranges[at] ?? 0;
    const to = ranges[at + 1] ?? 0;
    members.set(grid.order.subarray(from, to), cursor);
    cursor += to - from;
  }
  return members.sort();
}

export function triangleStarts(batch: PolygonBatch): Uint32Array {
  const starts = new Uint32Array(batch.count + 1);
  const { indices } = batch;
  let cursor = 0;
  for (let shape = 0; shape < batch.count; shape++) {
    const end = batch.starts[shape + 1] ?? 0;
    while (cursor < indices.length && (indices[cursor] ?? 0) < end) cursor += 3;
    starts[shape + 1] = cursor;
  }
  return starts;
}

function firstAtLeast(sorted: Uint32Array, value: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if ((sorted[middle] ?? 0) < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function polygonSubset(
  batch: PolygonBatch,
  triangles: Uint32Array,
  shapes: Uint32Array,
): PolygonBatch {
  let vertexTotal = 0;
  let indexTotal = 0;
  for (const shape of shapes) {
    vertexTotal += (batch.starts[shape + 1] ?? 0) - (batch.starts[shape] ?? 0);
    indexTotal += (triangles[shape + 1] ?? 0) - (triangles[shape] ?? 0);
  }
  const positions = new Float32Array(vertexTotal * 2);
  const starts = new Uint32Array(shapes.length + 1);
  const colors = new Uint8Array(shapes.length * 4);
  const indices = new Uint32Array(indexTotal);
  const holeStarts: number[] = [];
  const hasHoles = batch.holeStarts.length > 0;
  let vertexCursor = 0;
  let indexCursor = 0;
  for (let member = 0; member < shapes.length; member++) {
    const shape = shapes[member] ?? 0;
    const from = batch.starts[shape] ?? 0;
    const to = batch.starts[shape + 1] ?? 0;
    const shift = vertexCursor - from;
    positions.set(batch.positions.subarray(from * 2, to * 2), vertexCursor * 2);
    colors.set(batch.colors.subarray(shape * 4, shape * 4 + 4), member * 4);
    const indexFrom = triangles[shape] ?? 0;
    const indexTo = triangles[shape + 1] ?? 0;
    for (let index = indexFrom; index < indexTo; index++) {
      indices[indexCursor++] = (batch.indices[index] ?? 0) + shift;
    }
    if (hasHoles) {
      for (
        let hole = firstAtLeast(batch.holeStarts, from + 1);
        hole < batch.holeStarts.length;
        hole++
      ) {
        const start = batch.holeStarts[hole] ?? 0;
        if (start >= to) break;
        holeStarts.push(start + shift);
      }
    }
    vertexCursor += to - from;
    starts[member + 1] = vertexCursor;
  }
  return {
    count: shapes.length,
    positions,
    starts,
    colors,
    holeStarts: Uint32Array.from(holeStarts),
    indices,
  };
}

export function pointSubset(points: PointBatch, members: Uint32Array): PointBatch {
  const positions = new Float32Array(members.length * 2);
  const colors = new Uint8Array(members.length * 4);
  for (let at = 0; at < members.length; at++) {
    const point = members[at] ?? 0;
    positions[at * 2] = points.positions[point * 2] ?? 0;
    positions[at * 2 + 1] = points.positions[point * 2 + 1] ?? 0;
    colors[at * 4] = points.colors[point * 4] ?? 0;
    colors[at * 4 + 1] = points.colors[point * 4 + 1] ?? 0;
    colors[at * 4 + 2] = points.colors[point * 4 + 2] ?? 0;
    colors[at * 4 + 3] = points.colors[point * 4 + 3] ?? 0;
  }
  return { count: members.length, positions, colors };
}
