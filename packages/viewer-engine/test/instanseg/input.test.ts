import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  instansegInput,
  networkInput,
  paddedSize,
  percentile,
  resizeRgb,
  roundHalfEven,
  stretchChannels,
} from "../../src/instanseg/input.ts";

function patternTile(width: number, height: number) {
  const data = Uint8Array.from({ length: width * height * 3 }, (_, index) => (index * 37) % 256);
  return { data, width, height, channels: 3 };
}

describe("InstanSeg input", () => {
  it("resizes like Pillow's bilinear filter when shrinking", () => {
    const expected = [
      104, 126, 116, 134, 116, 125, 118, 137, 119, 125, 121, 140, 135, 125, 115, 102, 126, 135, 145,
      110, 127, 131, 148, 113, 121, 134, 151, 129, 125, 134, 114, 145, 135, 139, 121, 140, 133, 142,
      124, 140, 136, 104, 123, 144, 119,
    ];
    assert.deepEqual(Array.from(resizeRgb(patternTile(10, 6), 5, 3)), expected);
  });

  it("resizes like Pillow's bilinear filter at an uneven scale", () => {
    const expected = [
      70, 107, 111, 150, 98, 96, 120, 132, 132, 100, 137, 94, 138, 116, 153, 92, 126, 124, 162, 94,
      98, 114, 151, 158, 111, 127, 129, 161, 107, 137, 127, 164, 115, 143, 128, 133, 121, 155, 157,
      119, 138, 145, 78, 115, 122, 146, 103, 105, 131, 127, 132, 109, 146, 97, 138, 123, 153, 97,
      131, 133, 158, 102, 109, 125, 162, 166, 106, 137, 135, 168, 107, 144, 130, 167, 124, 150, 128,
      103, 131, 164, 73, 112, 149, 153,
    ];
    assert.deepEqual(Array.from(resizeRgb(patternTile(10, 6), 7, 4)), expected);
  });

  it("reads percentiles with numpy's linear rule", () => {
    const sorted = Float32Array.from([5, 1, 9, 3, 7, 2, 8]).sort();
    assert.ok(Math.abs(percentile(sorted, 0.1) - 1.006) < 1e-6);
    assert.ok(Math.abs(percentile(sorted, 99.9) - 8.994) < 1e-6);
  });

  it("stretches each channel to the unit range and leaves a flat channel at zero", () => {
    const planes = new Float32Array(3 * 16);
    for (let index = 0; index < 16; index += 1) {
      planes[index] = 20 + index * 4;
      planes[16 + index] = 100;
      planes[32 + index] = index;
    }
    stretchChannels(planes, 4, 4);
    assert.ok(Math.abs((planes[0] ?? 0) + 0.0001) < 0.01);
    assert.ok(Math.abs((planes[15] ?? 0) - 1) < 0.01);
    assert.ok(planes.subarray(16, 32).every((value) => value === 0));
  });

  it("rounds halves to even like Python", () => {
    assert.equal(roundHalfEven(2.5), 2);
    assert.equal(roundHalfEven(3.5), 4);
    assert.equal(roundHalfEven(3.4), 3);
    assert.equal(roundHalfEven(3.6), 4);
  });

  it("pads to a multiple of 16 by reflection and clamps the input range", () => {
    assert.equal(paddedSize(256), 256);
    assert.equal(paddedSize(250), 256);
    const planes = new Float32Array(3 * 14 * 18);
    planes.forEach((_, index) => {
      planes[index] = Math.fround((index % 18) / 10 + Math.floor(index / 18) / 100);
    });
    planes[0] = 9;
    planes[1] = -9;
    const input = networkInput(planes, 14, 18);
    assert.equal(input.paddedHeight, 16);
    assert.equal(input.paddedWidth, 32);
    assert.equal(input.pixels[0], 3);
    assert.equal(input.pixels[1], -2);
    assert.equal(input.pixels[18], planes[16]);
    assert.equal(input.pixels[19], planes[15]);
    assert.equal(input.pixels[14 * 32 + 5], planes[12 * 18 + 5]);
    assert.equal(input.pixels[15 * 32 + 20], planes[11 * 18 + 14]);
  });

  it("halves a quarter micron tile to the model scale and keeps an RGBA stride", () => {
    const rgba = new Uint8Array(64 * 48 * 4).map((_, index) => (index * 13) % 251);
    const input = instansegInput({ data: rgba, width: 64, height: 48, channels: 4 }, 0.25);
    assert.deepEqual([input.height, input.width], [24, 32]);
    assert.deepEqual([input.paddedHeight, input.paddedWidth], [32, 32]);
    const same = instansegInput({ data: rgba, width: 64, height: 48, channels: 4 }, 0.5);
    assert.deepEqual([same.height, same.width], [48, 64]);
  });
});
