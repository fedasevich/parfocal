import assert from "node:assert/strict";
import { test } from "node:test";
import { sizeScaleGeometry } from "../src/lib/size-scale.ts";

const range = {
  min: 0.05,
  max: 20,
  low: 5.9,
  high: 9.4,
  point: 7.7,
  cuts: [0.2, 2],
  dots: [
    { number: 1, mm: 7.7 },
    { number: 2, mm: 1.3 },
    { number: 3, mm: 0.15 },
  ],
};

test("the three tumor areas fall into the macro, micro and ITC zones", () => {
  const geometry = sizeScaleGeometry(range);
  const [macro, micro, itc] = geometry.dots;
  assert.ok((macro?.left ?? 0) > (geometry.cuts[1]?.left ?? 100));
  assert.ok((micro?.left ?? 0) > (geometry.cuts[0]?.left ?? 100));
  assert.ok((micro?.left ?? 100) < (geometry.cuts[1]?.left ?? 0));
  assert.ok((itc?.left ?? 100) < (geometry.cuts[0]?.left ?? 0));
});

test("the point sits inside the band and the band stays on the scale", () => {
  const geometry = sizeScaleGeometry(range);
  assert.ok(geometry.point >= geometry.bandLeft);
  assert.ok(geometry.point <= geometry.bandLeft + geometry.bandWidth);
  assert.ok(geometry.bandLeft >= 0);
  assert.ok(geometry.bandLeft + geometry.bandWidth <= 100);
});

test("the point dot and the point marker share one position", () => {
  const geometry = sizeScaleGeometry(range);
  assert.equal(geometry.dots[0]?.left, geometry.point);
});
