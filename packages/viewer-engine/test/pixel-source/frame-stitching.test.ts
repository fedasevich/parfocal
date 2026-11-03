import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evenStarts,
  frameLayout,
  rawWindow,
  resample,
  sampleAxis,
} from "../../src/pixel-source/tiff/frame-stitching.ts";
import type { SlideStitching } from "../../src/pixel-source/types.ts";

const stitching: SlideStitching = {
  columns: 3,
  rows: 2,
  frameWidth: 10,
  frameHeight: 8,
  columnX: [0, 7, 15],
  rowY: [0, 6],
  advanceX: 7.5,
  advanceY: 6,
  width: 25,
  height: 14,
};

describe("frame stitching geometry", () => {
  it("lays frames at the even advance the sidecar names", () => {
    const layout = frameLayout(stitching, 25, 14);
    assert.deepEqual(layout.across.starts, [0, 7.5, 15]);
    assert.deepEqual(layout.down.starts, [0, 6]);
  });

  it("derives the advance from the level 0 extent for a sidecar without one", () => {
    const { advanceX: _x, advanceY: _y, ...older } = stitching;
    const layout = frameLayout(older, 26, 14);
    assert.deepEqual(layout.across.starts, [0, 8, 16]);
    assert.deepEqual(layout.down.starts, [0, 6]);
  });

  it("lets the later frame win where two overlap and keeps the fraction", () => {
    const samples = sampleAxis({ starts: evenStarts(3, 7.5), frame: 10 }, 1, 30, 6, 10);
    const raw = Array.from(
      samples.low,
      (low, at) => low + samples.rawStart + (samples.weight[at] ?? 0),
    );
    assert.deepEqual(raw, [6, 7, 10.5, 11.5]);
    assert.equal(samples.rawStart, 6);
    assert.equal(samples.rawEnd, 13);
  });

  it("halves positions and frames on a level downsampled by two", () => {
    const samples = sampleAxis({ starts: evenStarts(3, 7.5), frame: 10 }, 2, 15, 3, 5);
    const raw = Array.from(
      samples.low,
      (low, at) => low + samples.rawStart + (samples.weight[at] ?? 0),
    );
    assert.deepEqual(raw, [3, 5.25]);
  });

  it("never samples past the last frame's last stored pixel", () => {
    const samples = sampleAxis({ starts: evenStarts(3, 7.5), frame: 10 }, 1, 30, 24, 26);
    assert.deepEqual(
      Array.from(samples.low, (low) => low + samples.rawStart),
      [29, 29],
    );
    assert.deepEqual(
      Array.from(samples.high, (high) => high + samples.rawStart),
      [29, 29],
    );
    assert.equal(samples.rawEnd, 30);
  });

  it("interpolates the stored pixels of the chosen frame", () => {
    const across = sampleAxis({ starts: evenStarts(3, 7.5), frame: 10 }, 1, 30, 6, 10);
    const down = sampleAxis({ starts: [0, 6], frame: 8 }, 1, 16, 5, 7);
    assert.deepEqual(rawWindow(across, down), [6, 5, 13, 10]);
    const rawWidth = 7;
    const plane = new Uint16Array(rawWidth * 5);
    for (let y = 0; y < 5; y++)
      for (let x = 0; x < rawWidth; x++) plane[y * rawWidth + x] = (6 + x) * 10 + (5 + y) * 100;
    const out = resample(plane, rawWidth, across, down);
    assert.ok(out instanceof Uint16Array);
    assert.deepEqual(Array.from(out), [560, 570, 605, 615, 860, 870, 905, 915]);
  });
});
