import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergePolygonBatches,
  type PolygonBatch,
  type PolygonInput,
  polygonBatchFromRings,
  StreamedScene,
} from "../../src/index.ts";

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function ring(centreX: number, centreY: number, radius: number, sides: number): number[] {
  const points: number[] = [];
  for (let side = 0; side < sides; side++) {
    const angle = (side / sides) * Math.PI * 2;
    points.push(centreX + Math.cos(angle) * radius, centreY + Math.sin(angle) * radius);
  }
  return points;
}

function tilePolygons(unit: number, count: number, seed: number): PolygonInput[] {
  const next = random(seed);
  const polygons: PolygonInput[] = [];
  for (let item = 0; item < count; item++) {
    const x = unit * 1000 + next() * 900;
    const y = next() * 900;
    const sides = 3 + Math.floor(next() * 22);
    const outer = ring(x, y, 4 + next() * 4, sides);
    if (item % 17 === 5) outer.push(outer[0] ?? 0, outer[1] ?? 0);
    const color = [
      Math.floor(next() * 256),
      Math.floor(next() * 256),
      Math.floor(next() * 256),
      255,
    ] as const;
    if (item % 11 === 3) {
      polygons.push({ ring: outer, holes: [ring(x, y, 1.5, 6)], color });
    } else if (item % 23 === 7) {
      polygons.push({ ring: [x, y, x + 1, y + 1], color });
    } else {
      polygons.push({ ring: Float32Array.from(outer), color });
    }
  }
  return polygons;
}

function assertSameBatch(actual: PolygonBatch, expected: PolygonBatch): void {
  assert.equal(actual.count, expected.count);
  assert.deepEqual(actual.positions, expected.positions);
  assert.deepEqual(actual.starts, expected.starts);
  assert.deepEqual(actual.colors, expected.colors);
  assert.deepEqual(actual.holeStarts, expected.holeStarts);
  assert.deepEqual(actual.indices, expected.indices);
}

describe("StreamedScene", () => {
  it("equals a scene built from scratch after appends, slices, a rebuild and a replaced tile", () => {
    const scene = new StreamedScene(60);
    const latest = new Map<number, PolygonInput[]>();
    const order: number[] = [];
    const sizes = [40, 7, 0, 55, 23, 81, 3, 64, 12, 30];
    sizes.forEach((size, unit) => {
      const polygons = tilePolygons(unit, size, unit + 1);
      order.push(unit);
      latest.set(unit, polygons);
      for (let start = 0, part = 0; start < Math.max(1, polygons.length); start += 16, part++) {
        scene.append("run-a", unit, polygons.slice(start, start + 16), part, unit + 1);
      }
      if (unit === 4) scene.rebuild();
    });
    const replaced = tilePolygons(3, 19, 99);
    scene.append("run-a", 3, replaced, 0, 20);
    latest.set(3, replaced);

    const scratch = polygonBatchFromRings(order.flatMap((unit) => latest.get(unit) ?? []));
    assertSameBatch(scene.merged(), scratch);
    assert.equal(scene.polygons("run-a"), scratch.count);
    assert.equal(scene.seqOf("run-a", 3), 20);
  });

  it("keeps lineages apart and in the order they began", () => {
    const scene = new StreamedScene(1000);
    const first = tilePolygons(0, 30, 3);
    const second = tilePolygons(1, 20, 4);
    scene.append("run-a", 0, first);
    scene.append("run-b", 0, second);
    assert.equal(scene.polygons("run-a"), 30);
    assert.equal(scene.polygons("run-b"), 20);
    assertSameBatch(scene.merged(), polygonBatchFromRings([...first, ...second]));
    scene.keepOnly("run-b");
    assertSameBatch(scene.merged(), polygonBatchFromRings(second));
  });

  it("rebuilds only the blocks that changed and keeps the others by reference", () => {
    const scene = new StreamedScene(50);
    for (let unit = 0; unit < 4; unit++) scene.append("run-a", unit, tilePolygons(unit, 50, unit));
    const before = scene.rebuild();
    assert.equal(before.length, 4);
    assert.equal(scene.dirtyBlocks(), 0);
    scene.append("run-a", 4, tilePolygons(4, 10, 9));
    assert.equal(scene.dirtyBlocks(), 1);
    const after = scene.rebuild();
    assert.equal(after.length, 5);
    for (let block = 0; block < 4; block++) {
      assert.equal(after[block]?.batch, before[block]?.batch);
      assert.equal(after[block]?.id, `run-a:${block}`);
    }
    scene.append("run-a", 1, tilePolygons(1, 5, 42));
    const replaced = scene.rebuild();
    assert.notEqual(replaced[1]?.batch, before[1]?.batch);
    assert.equal(replaced[0]?.batch, before[0]?.batch);
    assert.equal(replaced[1]?.batch.count, 5);
  });

  it("starts a new block when a tile lies far from the open block", () => {
    const square = (x: number, y: number): PolygonInput => ({
      ring: [x, y, x + 100, y, x + 100, y + 100, x, y + 100],
      color: [1, 2, 3, 255],
    });
    const scene = new StreamedScene(1000);
    scene.append("run-a", 0, [square(0, 0)]);
    scene.append("run-a", 1, [square(100, 0)]);
    assert.equal(scene.rebuild().length, 1);
    scene.append("run-a", 2, [square(0, 5000)]);
    assert.equal(scene.rebuild().length, 2);
  });

  it("merges nothing into an empty batch and one batch into itself", () => {
    const empty = mergePolygonBatches([]);
    assert.equal(empty.count, 0);
    assert.deepEqual(empty.starts, new Uint32Array([0]));
    const one = polygonBatchFromRings(tilePolygons(0, 4, 1));
    assert.equal(mergePolygonBatches([empty, one]), one);
  });
});
