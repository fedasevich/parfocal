import assert from "node:assert/strict";
import { test } from "node:test";
import type { SlideArea } from "@parfocal/api-client";
import { slideAreaEntries } from "../src/viewer/slide-areas.ts";

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

test("served areas become engine bounds with their size in mm", () => {
  assert.deepEqual(slideAreaEntries([row("T1", 400, 2.5), row("T2", 40, null)]), [
    { object: "T1", size: 2.5, bounds: { x: 10, y: 20, width: 400, height: 30 } },
    { object: "T2", size: 0, bounds: { x: 10, y: 20, width: 40, height: 30 } },
  ]);
});

test("an area with no extent is left out because the camera cannot fly to it", () => {
  assert.deepEqual(slideAreaEntries([row("T1", 0, 1)]), []);
});
