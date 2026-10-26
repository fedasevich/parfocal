import assert from "node:assert/strict";
import { test } from "node:test";
import { blockReport } from "#blocks.ts";
import { createFrame } from "#frame.ts";

function paint(size: number, blocks: number, colour: (column: number, row: number) => number) {
  const frame = createFrame(size * blocks, size * blocks);
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const value = colour(Math.floor(x / size), Math.floor(y / size));
      frame.data.set([value, value, value, 255], (y * frame.width + x) * 4);
    }
  }
  return frame;
}

const varied = (column: number, row: number) => (column * 37 + row * 91) % 256;

test("a frame of uniform blocks reports no mixed block", () => {
  const report = blockReport(paint(4, 5, varied), 4);
  assert.equal(report.blocks, 25);
  assert.equal(report.mixedBlocks, 0);
  assert.equal(report.neighbourPairs, 40);
  assert.equal(report.differingPairs, 40);
});

test("a one pixel shift makes the blocks mixed", () => {
  const frame = paint(4, 5, varied);
  const shifted = createFrame(frame.width, frame.height);
  shifted.data.set(frame.data.subarray(4), 0);
  assert.ok(blockReport(shifted, 4).mixedBlocks > 0);
});

test("a flat frame has uniform blocks that never differ", () => {
  const report = blockReport(
    paint(4, 3, () => 200),
    4,
  );
  assert.equal(report.mixedBlocks, 0);
  assert.equal(report.differingPairs, 0);
});

test("a block size that is not a positive integer is rejected", () => {
  assert.throws(() => blockReport(createFrame(8, 8), 0));
});
