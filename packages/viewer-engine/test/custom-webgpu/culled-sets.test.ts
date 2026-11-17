import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { culledDraw, culledSet, cullShapes } from "../../src/custom-webgpu/culled-sets.ts";
import {
  buildVectorInstances,
  shapeInstanceStarts,
} from "../../src/custom-webgpu/vector-instances.ts";
import { createPathBatch, polygonBatchFromRings } from "../../src/index.ts";
import type { ViewRect } from "../../src/overlay/cull-grid.ts";
import type { ShapeData } from "../../src/overlay/types.ts";

const side = 6;
const pitch = 20;
const perRow = 100;

function nucleiGrid(): ShapeData {
  const rings: { ring: number[]; color: [number, number, number, number] }[] = [];
  for (let shape = 0; shape < perRow * perRow; shape++) {
    const x = (shape % perRow) * pitch;
    const y = Math.floor(shape / perRow) * pitch;
    rings.push({
      ring: [x, y, x + side, y, x + side, y + side, x, y + side],
      color: [shape % 256, 0, 0, 255],
    });
  }
  rings.push({ ring: [100, 100, 400, 100, 400, 400, 100, 400], color: [0, 0, 255, 255] });
  return {
    polygons: polygonBatchFromRings(rings),
    paths: createPathBatch({
      positions: new Float32Array([0, 0, 50, 50, 90, 10]),
      starts: new Uint32Array([0, 3]),
      colors: new Uint8Array([0, 255, 0, 255]),
    }),
  };
}

function rangeTotal(ranges: readonly number[] | undefined): number {
  let total = 0;
  for (let at = 0; ranges && at + 1 < ranges.length; at += 2) {
    total += (ranges[at + 1] ?? 0) - (ranges[at] ?? 0);
  }
  return total;
}

function covers(ranges: readonly number[] | undefined, from: number, to: number): boolean {
  for (let at = 0; ranges && at + 1 < ranges.length; at += 2) {
    if ((ranges[at] ?? 0) <= from && to <= (ranges[at + 1] ?? 0)) return true;
  }
  return false;
}

describe("shape instance starts", () => {
  const polygons = polygonBatchFromRings([
    {
      ring: [0, 0, 10, 0, 10, 10, 0, 10],
      holes: [[2, 2, 4, 2, 4, 4]],
      color: [255, 0, 0, 128],
    },
    { ring: [20, 0, 30, 0, 25, 10], color: [0, 255, 0, 255] },
  ]);

  it("matches the instance counts the builder writes for every shape", () => {
    const { counts } = buildVectorInstances({ polygons });
    const starts = shapeInstanceStarts(polygons);
    assert.deepEqual([...starts.segments], [0, 7, 10]);
    assert.deepEqual([...starts.repeats], [0, 4, 6]);
    assert.equal(starts.triangles[2], counts.triangles);
    assert.ok((starts.triangles[1] ?? 0) > 0);
  });

  it("counts the split first edge and no repeats for dashed rings", () => {
    const options = { ringsFromMidFirstEdge: true };
    const { counts } = buildVectorInstances({ polygons }, options);
    const starts = shapeInstanceStarts(polygons, options);
    assert.deepEqual([...starts.segments], [0, 9, 13]);
    assert.equal(starts.segments[2], counts.segments);
    assert.deepEqual([...starts.repeats], [0, 0, 0]);
  });
});

describe("culled sets", () => {
  const shapes = nucleiGrid();
  const prepared = cullShapes(shapes);

  it("leaves a set below the level of detail threshold as it is", () => {
    const few = polygonBatchFromRings([{ ring: [0, 0, 6, 0, 6, 6], color: [1, 2, 3, 255] }]);
    assert.equal(cullShapes({ polygons: few }), null);
  });

  it("orders the small shapes by cell and keeps the large shape and the paths last", () => {
    assert.ok(prepared !== null);
    const polygons = prepared.shapes.polygons;
    assert.ok(polygons);
    assert.equal(polygons.count, perRow * perRow + 1);
    assert.equal(prepared.smallCount, perRow * perRow);
    const last = polygons.starts[polygons.count - 1] ?? 0;
    assert.deepEqual([...polygons.positions.subarray(last * 2, last * 2 + 2)], [100, 100]);
    assert.equal(prepared.shapes.paths, shapes.paths);
    assert.equal(prepared.centres.count, perRow * perRow);
    assert.ok(prepared.density !== null);
  });

  it("draws every shape that touches the view and few others at detail zoom", () => {
    assert.ok(prepared !== null);
    const { counts } = buildVectorInstances(prepared.shapes);
    const set = culledSet(prepared, counts);
    const view: ViewRect = [300, 300, 340, 330];
    const { choice, ranges, dots } = culledDraw(set, 20, view);
    assert.equal(choice.tier, "outlines");
    assert.equal(dots, null);
    const polygons = prepared.shapes.polygons;
    assert.ok(polygons);
    for (let shape = 0; shape < prepared.smallCount; shape++) {
      const x = polygons.positions[(polygons.starts[shape] ?? 0) * 2] ?? 0;
      const y = polygons.positions[(polygons.starts[shape] ?? 0) * 2 + 1] ?? 0;
      if (x + side < view[0] || x > view[2] || y + side < view[1] || y > view[3]) continue;
      const from = set.starts.segments[shape] ?? 0;
      const to = set.starts.segments[shape + 1] ?? 0;
      assert.ok(covers(ranges.segments, from, to), `shape at ${x}, ${y} is drawn`);
      const repeatFrom = set.starts.repeats[shape] ?? 0;
      const repeatTo = set.starts.repeats[shape + 1] ?? 0;
      assert.ok(covers(ranges.repeats, repeatFrom, repeatTo));
    }
    const tail = counts.segments - (set.starts.segments[prepared.smallCount] ?? 0);
    assert.ok(covers(ranges.segments, counts.segments - tail, counts.segments));
    assert.ok(rangeTotal(ranges.segments) < counts.segments / 4);
    const smallTriangles = set.starts.triangles[prepared.smallCount] ?? 0;
    assert.ok(covers(ranges.triangles, smallTriangles, counts.triangles));
    assert.ok(rangeTotal(ranges.triangles) < counts.triangles / 4);
  });

  it("draws all small shapes when no view is known", () => {
    assert.ok(prepared !== null);
    const { counts } = buildVectorInstances(prepared.shapes);
    const { ranges } = culledDraw(culledSet(prepared, counts), 20, undefined);
    assert.deepEqual(ranges.segments, [0, counts.segments]);
    assert.deepEqual(ranges.repeats, [0, counts.repeats]);
  });

  it("keeps only the large shape and the paths at the density tier", () => {
    assert.ok(prepared !== null);
    const { counts } = buildVectorInstances(prepared.shapes);
    const set = culledSet(prepared, counts);
    const { choice, ranges, dots } = culledDraw(set, 0.1, [0, 0, 800, 800]);
    assert.equal(choice.tier, "density");
    assert.equal(dots, null);
    assert.deepEqual(ranges.segments, [set.starts.segments[prepared.smallCount], counts.segments]);
    assert.deepEqual(ranges.repeats, [set.starts.repeats[prepared.smallCount], counts.repeats]);
  });

  it("draws the dots of the cells in view at the dots tier", () => {
    assert.ok(prepared !== null);
    const { counts } = buildVectorInstances(prepared.shapes);
    const set = culledSet(prepared, counts);
    const { choice, ranges, dots } = culledDraw(set, 0.5, [0, 0, 200, 200]);
    assert.equal(choice.tier, "dots");
    assert.ok(choice.dotRadiusPx > 0);
    assert.ok(dots !== null);
    const drawn = rangeTotal(dots);
    assert.ok(drawn >= 100 && drawn < perRow * perRow, `${drawn} dots`);
    assert.deepEqual(ranges.segments, [set.starts.segments[prepared.smallCount], counts.segments]);
  });
});
