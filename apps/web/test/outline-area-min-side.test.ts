import assert from "node:assert/strict";
import { test } from "node:test";
import { outlineArea, reviewMinSide } from "../src/viewer/stage-geometry.ts";

const tiny = [100, 100, 160, 100, 160, 160, 100, 160];

test("a tiny outline keeps its old padded area without a minimum", () => {
  const area = outlineArea(tiny);
  assert.equal(area?.width, 120);
});

test("a tiny outline opens on at least the review minimum so it is not a blur", () => {
  const area = outlineArea(tiny, reviewMinSide);
  assert.equal(area?.width, reviewMinSide);
  assert.equal(area?.height, reviewMinSide);
  assert.equal((area?.x ?? 0) + reviewMinSide / 2, 130);
});

test("a large outline is not changed by the minimum", () => {
  const large = [0, 0, 1000, 0, 1000, 1000, 0, 1000];
  assert.equal(outlineArea(large, reviewMinSide)?.width, 2000);
});
