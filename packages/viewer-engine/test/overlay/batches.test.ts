import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPolygonBatch,
  type PolygonBatch,
  pathBatchFromLines,
  pointBatchFromPoints,
  polygonBatchFromRings,
  triangulatePolygons,
} from "../../src/index.ts";

const red = [255, 0, 0, 255] as const;

function triangleArea(batch: PolygonBatch, triangle: number): number {
  const [a = 0, b = 0, c = 0] = batch.indices.subarray(triangle * 3, triangle * 3 + 3);
  const [ax = 0, ay = 0] = batch.positions.subarray(a * 2, a * 2 + 2);
  const [bx = 0, by = 0] = batch.positions.subarray(b * 2, b * 2 + 2);
  const [cx = 0, cy = 0] = batch.positions.subarray(c * 2, c * 2 + 2);
  return Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
}

function trianglesArea(batch: PolygonBatch): number {
  let area = 0;
  for (let triangle = 0; triangle < batch.indices.length / 3; triangle++) {
    area += triangleArea(batch, triangle);
  }
  return area;
}

test("a square becomes two triangles that cover its area", () => {
  const batch = polygonBatchFromRings([{ ring: [0, 0, 10, 0, 10, 10, 0, 10], color: red }]);
  assert.equal(batch.count, 1);
  assert.equal(batch.indices.length, 6);
  assert.equal(trianglesArea(batch), 100);
});

test("a concave L covers exactly its own area", () => {
  const ring = [0, 0, 20, 0, 20, 10, 10, 10, 10, 30, 0, 30];
  const batch = polygonBatchFromRings([{ ring, color: red }]);
  assert.equal(batch.indices.length, 12);
  assert.equal(trianglesArea(batch), 20 * 10 + 10 * 20);
});

test("indices point into the whole batch, not into their own polygon", () => {
  const batch = polygonBatchFromRings([
    { ring: [0, 0, 4, 0, 4, 4, 0, 4], color: red },
    { ring: [10, 10, 14, 10, 14, 14, 10, 14], color: red },
  ]);
  assert.deepEqual([...batch.starts], [0, 4, 8]);
  const second = [...batch.indices].slice(6);
  assert.equal(second.length, 6);
  for (const index of second) assert.ok(index >= 4 && index < 8);
  for (const index of [...batch.indices].slice(0, 6)) assert.ok(index < 4);
});

test("a ring that repeats its first vertex is stored open", () => {
  const batch = polygonBatchFromRings([{ ring: [0, 0, 4, 0, 4, 4, 0, 4, 0, 0], color: red }]);
  assert.deepEqual([...batch.starts], [0, 4]);
  assert.equal(batch.positions.length, 8);
});

test("a polygon with fewer than three vertices keeps its place and has no triangles", () => {
  const batch = polygonBatchFromRings([
    { ring: [0, 0, 5, 5], color: red },
    { ring: [0, 0, 4, 0, 0, 4], color: red },
  ]);
  assert.equal(batch.count, 2);
  assert.deepEqual([...batch.starts], [0, 2, 5]);
  assert.equal(batch.indices.length, 3);
  for (const index of batch.indices) assert.ok(index >= 2);
});

test("colours are stored once for each polygon", () => {
  const batch = polygonBatchFromRings([
    { ring: [0, 0, 4, 0, 0, 4], color: [1, 2, 3, 4] },
    { ring: [0, 0, 4, 0, 0, 4], color: [5, 6, 7, 8] },
  ]);
  assert.deepEqual([...batch.colors], [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("a flat batch whose starts do not match its positions is refused", () => {
  const positions = new Float32Array([0, 0, 1, 0, 0, 1]);
  const colors = new Uint8Array(4);
  assert.throws(
    () => createPolygonBatch({ positions, starts: new Uint32Array([0, 2]), colors }),
    /end at the vertex count/,
  );
  assert.throws(
    () =>
      createPolygonBatch({ positions, starts: new Uint32Array([0, 3]), colors: new Uint8Array(3) }),
    /one RGBA colour/,
  );
  assert.throws(
    () =>
      createPolygonBatch({
        positions: new Float32Array(5),
        starts: new Uint32Array([0, 2]),
        colors,
      }),
    /x and y pairs/,
  );
});

test("triangulating nothing gives no indices", () => {
  assert.equal(triangulatePolygons(new Float32Array(0), new Uint32Array([0])).length, 0);
});

test("paths and points are packed in order", () => {
  const paths = pathBatchFromLines([
    { line: [0, 0, 1, 1, 2, 2], color: red },
    { line: [5, 5, 6, 6], color: red },
  ]);
  assert.deepEqual([...paths.starts], [0, 3, 5]);
  const points = pointBatchFromPoints([
    { x: 1, y: 2, color: red },
    { x: 3, y: 4, color: [0, 255, 0, 255] },
  ]);
  assert.equal(points.count, 2);
  assert.deepEqual([...points.positions], [1, 2, 3, 4]);
  assert.deepEqual([...points.colors], [255, 0, 0, 255, 0, 255, 0, 255]);
});

const outer = [0, 0, 40, 0, 40, 40, 0, 40];
const hole = [10, 10, 10, 30, 30, 30, 30, 10];
const island = [18, 18, 22, 18, 22, 22, 18, 22];

function covers(batch: PolygonBatch, x: number, y: number): boolean {
  for (let triangle = 0; triangle < batch.indices.length / 3; triangle++) {
    const [a = 0, b = 0, c = 0] = batch.indices.subarray(triangle * 3, triangle * 3 + 3);
    const point = (index: number) => [
      batch.positions[index * 2] ?? 0,
      batch.positions[index * 2 + 1] ?? 0,
    ];
    const [ax = 0, ay = 0] = point(a);
    const [bx = 0, by = 0] = point(b);
    const [cx = 0, cy = 0] = point(c);
    const d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by);
    const d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy);
    const d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay);
    const negative = d1 < 0 || d2 < 0 || d3 < 0;
    const positive = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(negative && positive)) return true;
  }
  return false;
}

test("a square with a square hole gets eight triangles and none covers the hole", () => {
  const batch = polygonBatchFromRings([{ ring: outer, holes: [hole], color: red }]);
  assert.equal(batch.count, 1);
  assert.deepEqual([...batch.starts], [0, 8]);
  assert.deepEqual([...batch.holeStarts], [4]);
  assert.equal(batch.indices.length / 3, 8);
  assert.equal(trianglesArea(batch), 40 * 40 - 20 * 20);
  assert.equal(covers(batch, 20, 20), false);
  assert.equal(covers(batch, 5, 5), true);
  assert.equal(covers(batch, 35, 20), true);
});

test("an island polygon inside a hole is filled and the hole around it stays empty", () => {
  const batch = polygonBatchFromRings([
    { ring: outer, holes: [hole], color: red },
    { ring: island, color: red },
  ]);
  assert.deepEqual([...batch.starts], [0, 8, 12]);
  assert.equal(batch.indices.length / 3, 10);
  assert.equal(trianglesArea(batch), 40 * 40 - 20 * 20 + 16);
  assert.equal(covers(batch, 20, 20), true);
  assert.equal(covers(batch, 14, 20), false);
  assert.equal(covers(batch, 26, 20), false);
});

test("hole indices stay local to their polygon in a later polygon", () => {
  const shift = (ring: number[]) => ring.map((value, index) => value + (index % 2 === 0 ? 100 : 0));
  const batch = polygonBatchFromRings([
    { ring: [0, 0, 4, 0, 4, 4, 0, 4], color: red },
    { ring: shift(outer), holes: [shift(hole)], color: red },
  ]);
  assert.deepEqual([...batch.holeStarts], [8]);
  assert.equal(batch.indices.length / 3, 2 + 8);
  assert.equal(covers(batch, 120, 20), false);
  assert.equal(covers(batch, 105, 5), true);
});

test("a hole with fewer than three vertices is dropped", () => {
  const batch = polygonBatchFromRings([{ ring: outer, holes: [[5, 5, 6, 6]], color: red }]);
  assert.equal(batch.holeStarts.length, 0);
  assert.equal(batch.indices.length / 3, 2);
});

test("flat batches reject hole starts outside their polygon", () => {
  const positions = new Float32Array([...outer, ...hole]);
  const base = { positions, starts: new Uint32Array([0, 4, 8]), colors: new Uint8Array(8) };
  assert.throws(() => createPolygonBatch({ ...base, holeStarts: Uint32Array.of(4) }), RangeError);
  assert.throws(() => createPolygonBatch({ ...base, holeStarts: Uint32Array.of(0) }), RangeError);
});
