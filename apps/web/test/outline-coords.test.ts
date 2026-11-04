import assert from "node:assert/strict";
import { test } from "node:test";
import {
  imageOfKind,
  ringOfGeometry,
  slideToStill,
  stillToSlide,
} from "../src/screens/review/outline-coords.ts";
import { cropCentre, levelZero } from "../src/screens/viewer-tools/tool-geometry.ts";

test("an overview point maps to level 0 pixels by the overview scale", () => {
  const slide = stillToSlide({ x: 1000, y: 1100 }, "overview");
  assert.equal(slide.x, Math.round(1000 * levelZero.overview * 10) / 10);
  assert.equal(slide.y, Math.round(1100 * levelZero.overview * 10) / 10);
});

test("the centre of the high power image maps to the crop centre on the slide", () => {
  const slide = stillToSlide({ x: 800, y: 500 }, "hpf");
  assert.ok(Math.abs(slide.x - cropCentre.hpf[0] * levelZero.overview) < 0.1);
  assert.ok(Math.abs(slide.y - cropCentre.hpf[1] * levelZero.overview) < 0.1);
});

test("a point survives the trip to the slide and back", () => {
  for (const image of ["overview", "hpf"] as const) {
    const back = slideToStill(stillToSlide({ x: 640.5, y: 312.2 }, image), image);
    assert.ok(Math.abs(back.x - 640.5) < 0.2);
    assert.ok(Math.abs(back.y - 312.2) < 0.2);
  }
});

test("regions use the overview and cells the high power image", () => {
  assert.equal(imageOfKind("region"), "overview");
  assert.equal(imageOfKind("cell"), "hpf");
});

test("a saved polygon comes back as its open ring", () => {
  const ring = ringOfGeometry({
    type: "Polygon",
    coordinates: [
      [
        [1, 2],
        [5, 2],
        [3, 6],
        [1, 2],
      ],
    ],
  });
  assert.deepEqual(ring, [
    { x: 1, y: 2 },
    { x: 5, y: 2 },
    { x: 3, y: 6 },
  ]);
  assert.equal(ringOfGeometry(null), null);
  assert.equal(ringOfGeometry({ type: "Point", coordinates: [1, 2] }), null);
});
