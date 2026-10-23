import assert from "node:assert/strict";
import { test } from "node:test";
import { compareFrames, describeComparison, diffFrame, EXACT } from "#compare.ts";
import { createFrame, swapRedAndBlue } from "#frame.ts";
import { syntheticHeTile } from "#synthetic-tile.ts";
import { CODEC_TOLERANCES, FORMAT_CODECS, SLIDE_FORMATS, toleranceFor } from "#tolerances.ts";

const tile = syntheticHeTile(64);

function nudged(by: number, everyNth: number) {
  const data = new Uint8Array(tile.data);
  for (let offset = 0; offset < data.length; offset += 4 * everyNth) {
    data[offset + 1] = Math.min(255, (data[offset + 1] ?? 0) + by);
  }
  return createFrame(tile.width, tile.height, data);
}

test("an identical frame passes the exact tolerance", () => {
  const comparison = compareFrames(tile, createFrame(64, 64, new Uint8Array(tile.data)), EXACT);
  assert.equal(comparison.pass, true);
  assert.deepEqual(comparison.maxDelta, [0, 0, 0]);
  assert.equal(comparison.channelHint, null);
});

test("a delta at the per-channel limit passes and one above it counts as differing", () => {
  const tolerance = { maxChannelDelta: 2, maxDifferingFraction: 0, maxMeanChannelError: 10 };
  assert.equal(compareFrames(nudged(2, 1), tile, tolerance).pass, true);
  const over = compareFrames(nudged(3, 1), tile, tolerance);
  assert.equal(over.pass, false);
  assert.ok(over.differingPixels > 0);
});

test("a few differing pixels pass when the fraction allows them", () => {
  const tolerance = { maxChannelDelta: 0, maxDifferingFraction: 0.05, maxMeanChannelError: 1 };
  assert.equal(compareFrames(nudged(1, 64), tile, tolerance).pass, true);
  assert.equal(compareFrames(nudged(1, 2), tile, tolerance).pass, false);
});

test("swapped red and blue fail every codec tolerance and name the swap", () => {
  const swapped = swapRedAndBlue(tile);
  for (const [codec, tolerance] of Object.entries(CODEC_TOLERANCES)) {
    const comparison = compareFrames(swapped, tile, tolerance);
    assert.equal(comparison.pass, false, codec);
    assert.equal(comparison.meanError[1], 0);
    assert.match(comparison.channelHint ?? "", /BGR order/);
    assert.match(describeComparison(comparison), /swaps colour channels/);
  }
});

test("a size mismatch fails without comparing pixels", () => {
  const comparison = compareFrames(createFrame(32, 64), tile, CODEC_TOLERANCES.jpeg2000);
  assert.equal(comparison.pass, false);
  assert.match(comparison.failures[0] ?? "", /32x64/);
});

test("the diff image marks differing pixels in magenta and fades matching ones", () => {
  const diff = diffFrame(swapRedAndBlue(tile), tile, EXACT);
  const pixel = (x: number, y: number) =>
    Array.from(diff.data.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));
  assert.deepEqual(pixel(32, 5), [255, 0, 255, 255]);
  const greenStrip = pixel(32, 15);
  assert.equal(greenStrip[0], greenStrip[1]);
  assert.ok((greenStrip[0] ?? 0) >= 192);
});

test("every slide format has a codec and lossless is the strictest", () => {
  for (const format of SLIDE_FORMATS) {
    assert.ok(CODEC_TOLERANCES[FORMAT_CODECS[format]], format);
    assert.ok(toleranceFor(format).maxChannelDelta >= CODEC_TOLERANCES.lossless.maxChannelDelta);
  }
  assert.ok(CODEC_TOLERANCES.lossless.maxChannelDelta < CODEC_TOLERANCES.jpeg.maxChannelDelta);
  assert.ok(CODEC_TOLERANCES.jpeg.maxChannelDelta < CODEC_TOLERANCES.jpeg2000.maxChannelDelta);
});
