import assert from "node:assert/strict";
import { test } from "node:test";
import { createPinAtlas, pinColors, pinIconSize } from "../../src/index.ts";

function pixel(atlas: ReturnType<typeof createPinAtlas>, x: number, y: number) {
  const offset = (y * atlas.width + x) * 4;
  return [...atlas.rgba.subarray(offset, offset + 4)];
}

test("the atlas holds an open and a resolved pin side by side", () => {
  const atlas = createPinAtlas();
  assert.equal(atlas.width, pinIconSize * 2);
  assert.equal(atlas.height, pinIconSize);
  assert.equal(atlas.mapping.open.x, 0);
  assert.equal(atlas.mapping.resolved.x, pinIconSize);
  assert.equal(atlas.mapping.open.anchorY, atlas.mapping.resolved.anchorY);
});

test("the corners are clear and the head is filled with the state colour", () => {
  const atlas = createPinAtlas();
  assert.equal(pixel(atlas, 0, 0)[3], 0);
  assert.equal(pixel(atlas, pinIconSize - 1, 0)[3], 0);
  const open = pixel(atlas, 32 + 9, 22);
  const resolved = pixel(atlas, pinIconSize + 32 + 9, 22);
  assert.deepEqual(open.slice(0, 3), [...pinColors.open]);
  assert.deepEqual(resolved.slice(0, 3), [...pinColors.resolved]);
  assert.equal(open[3], 255);
});

test("the pin narrows to a tip that sits on the anchor", () => {
  const atlas = createPinAtlas();
  const { anchorX, anchorY } = atlas.mapping.open;
  assert.ok((pixel(atlas, anchorX, anchorY - 3)[3] ?? 0) > 0);
  assert.equal(pixel(atlas, anchorX - 8, anchorY - 3)[3], 0);
  assert.equal(pixel(atlas, anchorX + 8, anchorY - 3)[3], 0);
});
