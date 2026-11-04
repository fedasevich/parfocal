import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { snapTo45 } from "../src/annotations/polygon-draft.ts";

describe("snapTo45", () => {
  test("snaps to the nearest 45 degree direction and keeps the distance", () => {
    const snapped = snapTo45([{ x: 10, y: 10 }], { x: 110, y: 22 });
    assert.ok(Math.abs(snapped.x - (10 + Math.hypot(100, 12))) < 1e-9);
    assert.ok(Math.abs(snapped.y - 10) < 1e-9);
    const diagonal = snapTo45([{ x: 0, y: 0 }], { x: 50, y: 60 });
    assert.ok(Math.abs(diagonal.x - diagonal.y) < 1e-9);
  });

  test("leaves the point alone with no vertex yet", () => {
    assert.deepEqual(snapTo45([], { x: 3, y: 4 }), { x: 3, y: 4 });
  });
});
