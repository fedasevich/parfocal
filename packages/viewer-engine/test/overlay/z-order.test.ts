import assert from "node:assert/strict";
import { test } from "node:test";
import { isOverlayKind, overlayOrder, overlayOrderStep, overlayStack } from "../../src/index.ts";

test("the stack runs from the coverage raster at the bottom to comment pins on top", () => {
  assert.deepEqual(
    [...overlayStack],
    [
      "coverage",
      "heatmap",
      "nuclei",
      "ai-proposals",
      "human-annotations",
      "measurements",
      "comment-pins",
    ],
  );
});

test("every kind has its own order, rising up the stack and above a bare engine overlay", () => {
  const orders = overlayStack.map(overlayOrder);
  assert.deepEqual(
    orders,
    [...orders].sort((a, b) => a - b),
  );
  assert.equal(new Set(orders).size, overlayStack.length);
  assert.ok((orders[0] ?? 0) >= overlayOrderStep);
});

test("only the seven kinds are recognised", () => {
  for (const kind of overlayStack) assert.equal(isOverlayKind(kind), true);
  assert.equal(isOverlayKind("labels"), false);
  assert.equal(isOverlayKind(undefined), false);
});
