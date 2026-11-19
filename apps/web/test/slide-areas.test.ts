import assert from "node:assert/strict";
import { test } from "node:test";
import type { SlideArea } from "@parfocal/api-client";
import { areaPixels, areasUnsized, rankSize, slideAreaEntries } from "../src/viewer/slide-areas.ts";

const row = (object: string, width: number, size: number | null): SlideArea => ({
  object,
  number: Number(object.slice(1)),
  result_set_id: "00000000-0000-4000-8000-000000000001",
  x: 10,
  y: 20,
  width,
  height: 30,
  size_mm: size,
});

test("served areas become engine bounds with their size in mm, or none when it is unknown", () => {
  assert.deepEqual(slideAreaEntries([row("T1", 400, 2.5), row("T2", 40, null)]), [
    { object: "T1", size: 2.5, bounds: { x: 10, y: 20, width: 400, height: 30 } },
    { object: "T2", size: null, bounds: { x: 10, y: 20, width: 40, height: 30 } },
  ]);
});

test("a slide without a pixel size ranks its areas by their longest side in pixels", () => {
  const unsized = slideAreaEntries([row("T1", 40, null), row("T2", 400, null)]);
  assert.equal(areasUnsized(unsized), true);
  assert.deepEqual(unsized.map(rankSize), [40, 400]);
  assert.deepEqual(unsized.map(areaPixels), [40, 400]);
  const sized = slideAreaEntries([row("T1", 40, 0.04)]);
  assert.equal(areasUnsized(sized), false);
  assert.deepEqual(sized.map(rankSize), [0.04]);
  assert.equal(areasUnsized([]), false);
});

test("an area with no extent is left out because the camera cannot fly to it", () => {
  assert.deepEqual(slideAreaEntries([row("T1", 0, 1)]), []);
});
