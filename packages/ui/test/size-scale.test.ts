import assert from "node:assert/strict";
import { test } from "node:test";
import { countBarGeometry, logPosition, sizeScaleGeometry } from "../src/lib/size-scale.ts";

const base = { min: 0.05, max: 20, low: 1, high: 3, point: 2, cuts: [0.2, 2] };
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test("the 0.2 mm line sits where the log of 4 over the log of 400 says", () => {
  const expected = (Math.log10(4) / Math.log10(400)) * 100;
  near(logPosition(0.2, 0.05, 20), expected);
  near(sizeScaleGeometry(base).cuts[0]?.left ?? -1, expected);
});

test("the 2 mm line sits where the log of 40 over the log of 400 says", () => {
  const geometry = sizeScaleGeometry(base);
  near(geometry.cuts[1]?.left ?? -1, (Math.log10(40) / Math.log10(400)) * 100);
  near(geometry.point, geometry.cuts[1]?.left ?? -1);
});

test("the three zones are split at 0.2 and 2 mm and fill the whole scale", () => {
  const geometry = sizeScaleGeometry(base);
  assert.deepEqual(
    geometry.zones.map((zone) => zone.name),
    ["ITC", "micro", "macro"],
  );
  near(geometry.zones[0]?.left ?? -1, 0);
  near(geometry.zones[1]?.left ?? -1, geometry.cuts[0]?.left ?? -1);
  near(geometry.zones[2]?.left ?? -1, geometry.cuts[1]?.left ?? -1);
  near(
    geometry.zones.reduce((sum, zone) => sum + zone.width, 0),
    100,
  );
});

test("the ends of the scale are 0 and 100 and each area gets a dot", () => {
  near(logPosition(0.05, 0.05, 20), 0);
  near(logPosition(20, 0.05, 20), 100);
  const geometry = sizeScaleGeometry({
    ...base,
    dots: [
      { number: 1, mm: 7.7 },
      { number: 2, mm: 0.2 },
    ],
  });
  assert.deepEqual(
    geometry.dots.map((dot) => dot.number),
    [1, 2],
  );
  near(geometry.dots[1]?.left ?? -1, geometry.cuts[0]?.left ?? -1);
});

test("the band ends at the high size", () => {
  const geometry = sizeScaleGeometry(base);
  near(geometry.bandLeft + geometry.bandWidth, logPosition(3, 0.05, 20));
});

test("the count bar puts the line at 200 of 400 and flips at the line", () => {
  assert.deepEqual(countBarGeometry(100, 200, 400), { fill: 25, line: 50, over: false });
  assert.equal(countBarGeometry(200, 200, 400).over, true);
  assert.equal(countBarGeometry(900, 200, 400).fill, 100);
  assert.equal(countBarGeometry(-5, 200, 400).fill, 0);
});
