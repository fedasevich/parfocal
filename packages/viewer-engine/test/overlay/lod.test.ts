import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chooseLod,
  createPolygonBatch,
  densityRaster,
  fullDetail,
  largeShapes,
  lodDotRadiusPx,
  lodKey,
  lodStats,
  type PolygonBatch,
  shapeDiagonals,
  smallShapeCentres,
} from "../../src/index.ts";

const nucleusSide = 6;
const nucleusDiagonal = Math.hypot(nucleusSide, nucleusSide);
const pitch = 20;

function squares(count: number, large: readonly number[] = []): PolygonBatch {
  const total = count + large.length;
  const positions = new Float32Array(total * 8);
  const starts = new Uint32Array(total + 1);
  const colors = new Uint8Array(total * 4);
  const columns = Math.ceil(Math.sqrt(total));
  for (let shape = 0; shape < total; shape++) {
    const side = shape < count ? nucleusSide : (large[shape - count] ?? 0);
    const x = (shape % columns) * pitch;
    const y = Math.floor(shape / columns) * pitch;
    positions.set([x, y, x + side, y, x + side, y + side, x, y + side], shape * 8);
    starts[shape + 1] = (shape + 1) * 4;
    colors.set(shape < count ? [200, 40, 40, 128] : [40, 40, 200, 255], shape * 4);
  }
  return createPolygonBatch({ positions, starts, colors });
}

const scaleFor = (sizePx: number): number => sizePx / nucleusDiagonal;

test("the nucleus size is the median diagonal of the shapes", () => {
  const batch = squares(600, [400]);
  assert.ok(Math.abs((shapeDiagonals(batch)[0] ?? 0) - nucleusDiagonal) < 1e-5);
  assert.ok(Math.abs(lodStats(batch).nucleusSize - nucleusDiagonal) < 1e-5);
});

test("a nucleus under 2 px is density, from 2 px dots and from 7 px outlines", () => {
  const stats = lodStats(squares(600));
  assert.equal(chooseLod(stats, scaleFor(1.99)).tier, "density");
  assert.equal(chooseLod(stats, scaleFor(2.01)).tier, "dots");
  assert.equal(chooseLod(stats, scaleFor(6.99)).tier, "dots");
  assert.equal(chooseLod(stats, scaleFor(7.01)).tier, "outlines");
  assert.equal(chooseLod(stats, scaleFor(40)).tier, "outlines");
  assert.equal(chooseLod(stats, scaleFor(0.01)).tier, "density");
});

test("the tier borders are exact when the size is exact", () => {
  const stats = { nucleusSize: 1, smallCount: 500, large: new Uint32Array(0), engaged: true };
  assert.equal(chooseLod(stats, 2).tier, "dots");
  assert.equal(chooseLod(stats, 7).tier, "outlines");
});

test("level of detail engages only from 500 nucleus-sized shapes", () => {
  const few = lodStats(squares(499));
  const enough = lodStats(squares(500));
  assert.equal(few.engaged, false);
  assert.equal(enough.engaged, true);
  assert.deepEqual(chooseLod(few, scaleFor(0.5)), fullDetail);
  assert.equal(chooseLod(enough, scaleFor(0.5)).tier, "density");
});

test("large shapes do not count towards the 500", () => {
  const stats = lodStats(squares(499, [300, 300, 300]));
  assert.equal(stats.smallCount, 499);
  assert.equal(stats.engaged, false);
});

test("shapes over three nucleus sizes are large and stay as outlines", () => {
  const batch = squares(600, [nucleusSide * 2.9, nucleusSide * 3.1, 400]);
  const stats = lodStats(batch);
  assert.deepEqual([...stats.large], [601, 602]);
  assert.equal(stats.smallCount, 601);
  const large = largeShapes(batch, stats);
  assert.equal(large?.count, 2);
  assert.deepEqual([...(large?.starts ?? [])], [0, 4, 8]);
  assert.deepEqual([...(large?.colors.subarray(0, 4) ?? [])], [40, 40, 200, 255]);
  assert.equal(large?.indices.length, 12);
  assert.equal(largeShapes(squares(600), lodStats(squares(600))), null);
});

test("a large shape keeps its hole", () => {
  const small = squares(500);
  const outer = [0, 0, 300, 0, 300, 300, 0, 300];
  const hole = [100, 100, 200, 100, 200, 200, 100, 200];
  const vertices = small.positions.length / 2;
  const positions = new Float32Array(small.positions.length + 16);
  positions.set(small.positions);
  positions.set([...outer, ...hole], small.positions.length);
  const batch = createPolygonBatch({
    positions,
    starts: Uint32Array.from([...small.starts, vertices + 8]),
    colors: Uint8Array.from([...small.colors, 1, 2, 3, 255]),
    holeStarts: Uint32Array.of(vertices + 4),
  });
  const large = largeShapes(batch, lodStats(batch));
  assert.equal(large?.count, 1);
  assert.deepEqual([...(large?.holeStarts ?? [])], [4]);
});

test("the dot grows with the nucleus between 0.8 and 2.2 px", () => {
  assert.equal(lodDotRadiusPx(2), 0.8);
  assert.equal(lodDotRadiusPx(5), 1.5);
  assert.equal(lodDotRadiusPx(7), 2.1);
  assert.equal(lodDotRadiusPx(20), 2.2);
});

test("the key changes with the tier and the dot radius and with nothing else", () => {
  const stats = lodStats(squares(600));
  assert.equal(lodKey(chooseLod(stats, scaleFor(0.5))), lodKey(chooseLod(stats, scaleFor(1.5))));
  assert.equal(lodKey(chooseLod(stats, scaleFor(9))), lodKey(chooseLod(stats, scaleFor(90))));
  assert.notEqual(lodKey(chooseLod(stats, scaleFor(3))), lodKey(chooseLod(stats, scaleFor(6))));
  assert.notEqual(lodKey(chooseLod(stats, scaleFor(1))), lodKey(chooseLod(stats, scaleFor(3))));
});

test("dots sit at the centre of each small shape in its opaque colour", () => {
  const batch = squares(600, [400]);
  const centres = smallShapeCentres(batch, lodStats(batch));
  assert.equal(centres.count, 600);
  assert.deepEqual([...centres.positions.subarray(0, 2)], [3, 3]);
  assert.deepEqual([...centres.colors.subarray(0, 4)], [200, 40, 40, 255]);
});

test("the density texture covers the shapes, is capped in size and carries their colour", () => {
  const batch = squares(2500);
  const stats = lodStats(batch);
  const centres = smallShapeCentres(batch, stats);
  const raster = densityRaster(centres, stats.nucleusSize);
  assert.ok(raster);
  assert.ok(raster.width <= 1026 && raster.height <= 1026);
  assert.ok(raster.area.x < 0 && raster.area.x + raster.area.width > 49 * pitch + nucleusSide);
  const middle = (Math.floor(raster.height / 2) * raster.width + Math.floor(raster.width / 2)) * 4;
  assert.ok((raster.rgba[middle] ?? 0) > 150);
  assert.ok((raster.rgba[middle + 3] ?? 0) > 0);
  assert.ok(
    Math.max(...raster.rgba.filter((_, index) => index % 4 === 3)) <= Math.round(0.45 * 255),
  );
  assert.equal(densityRaster({ ...centres, count: 0 }, stats.nucleusSize), null);
});
