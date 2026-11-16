import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePostProcess } from "../../src/instanseg/index.ts";
import {
  connectedComponents,
  floodFill,
  holesOf,
  type InstanSegPostProcess,
  instansegLabels,
  seedPeaks,
} from "../../src/instanseg/labels.ts";

const side = 64;

function distanceClassifier(bias: number): InstanSegPostProcess["classifier"] {
  return parsePostProcess({
    classifier: [
      {
        weights: [
          [1, 0, 0, 0],
          [-1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, -1, 0, 0],
        ],
        bias: [0, 0, 0, 0],
      },
      { weights: [[-4, -4, -4, -4]], bias: [bias] },
    ],
    maskThreshold: 0.53,
    peakDistance: 5,
    seedThreshold: 0.7,
    overlapThreshold: 0.3,
    windowSize: 32,
  }).classifier;
}

function post(bias: number, peakDistance = 5): InstanSegPostProcess {
  return {
    classifier: distanceClassifier(bias),
    maskThreshold: 0.53,
    peakDistance,
    seedThreshold: 0.7,
    overlapThreshold: 0.3,
    windowSize: 32,
  };
}

function mapsWithSeeds(seeds: readonly (readonly [number, number])[]) {
  const plane = side * side;
  const data = new Float32Array(5 * plane);
  for (const [row, column] of seeds) data[4 * plane + row * side + column] = 6;
  return { data, height: side, width: side };
}

function labelSet(labels: Int32Array): number[] {
  return [...new Set(labels)].filter((label) => label > 0).sort((a, b) => a - b);
}

function mask(cells: readonly number[], size: number): (index: number) => boolean {
  const set = new Set(cells);
  return (index) => index < size * size && set.has(index);
}

describe("InstanSeg seeds", () => {
  it("keeps a peak above the threshold and gives ties to the first pixel in row order", () => {
    const map = new Float32Array(100);
    map[22] = 0.9;
    map[25] = 0.9;
    map[88] = 0.95;
    map[55] = 0.6;
    assert.deepEqual(seedPeaks(map, 10, 10, 1, 0.7), [22, 25, 88]);
    assert.deepEqual(seedPeaks(map, 10, 10, 5, 0.7), [22, 88]);
    assert.deepEqual(seedPeaks(map, 10, 10, 6, 0.7), [88]);
    map[88] = 0.9;
    assert.deepEqual(seedPeaks(map, 10, 10, 6, 0.7), [22]);
  });
});

describe("InstanSeg flood fill", () => {
  it("starts from the seed's neighbours even when the seed is below the threshold", () => {
    const size = 5;
    const reached = floodFill(mask([7, 8, 13], size), [12], size, size);
    assert.deepEqual(
      reached.sort((a, b) => a - b),
      [7, 8, 13],
    );
  });

  it("stops after the level cap", () => {
    const size = 8;
    const row = Array.from({ length: size }, (_, column) => column);
    const reached = floodFill(mask(row, size), [0], size, 3);
    assert.deepEqual(
      reached.sort((a, b) => a - b),
      [0, 1, 2, 3],
    );
  });

  it("finds an enclosed hole and nothing open to the outside", () => {
    const size = 16;
    const ring: number[] = [];
    for (let row = 4; row <= 8; row += 1) {
      for (let column = 4; column <= 8; column += 1) {
        if (row === 6 && column === 6) continue;
        ring.push(row * size + column);
      }
    }
    assert.deepEqual(holesOf(ring, size, size), [6 * size + 6]);
    const open = ring.filter((index) => index !== 4 * size + 6);
    const holes = holesOf(open, size, size);
    assert.ok(holes.includes(6 * size + 6));
    assert.deepEqual(holesOf([], size, size), []);
  });
});

describe("InstanSeg components", () => {
  it("gives each component its smallest label within the iteration cap", () => {
    const chain = [[1], [0, 2], [1], [4], [3]];
    assert.deepEqual(Array.from(connectedComponents(chain, 100)), [1, 1, 1, 4, 4]);
    assert.deepEqual(Array.from(connectedComponents(chain, 1)), [1, 1, 2, 4, 4]);
  });
});

describe("InstanSeg labels", () => {
  it("returns no labels when no seed passes the threshold", () => {
    const result = instansegLabels(mapsWithSeeds([]), side, side, post(3));
    assert.equal(result.seeds, 0);
    assert.equal(labelSet(result.labels).length, 0);
  });

  it("labels separate nuclei around separate seeds", () => {
    const result = instansegLabels(
      mapsWithSeeds([
        [10, 10],
        [40, 50],
      ]),
      side,
      side,
      post(3),
    );
    assert.equal(result.seeds, 2);
    assert.deepEqual(labelSet(result.labels), [1, 2]);
    assert.equal(result.labels[10 * side + 10], 1);
    assert.equal(result.labels[40 * side + 50], 2);
    assert.equal(result.labels[10 * side + 11], 1);
    assert.equal(result.labels[25 * side + 25], 0);
  });

  it("merges two seeds whose masks overlap past the overlap threshold", () => {
    const result = instansegLabels(
      mapsWithSeeds([
        [30, 30],
        [30, 34],
      ]),
      side,
      side,
      post(8, 2),
    );
    assert.equal(result.seeds, 2);
    assert.deepEqual(labelSet(result.labels), [1]);
    assert.equal(result.labels[30 * side + 34], 1);
  });

  it("refuses maps without five channels", () => {
    assert.throws(() =>
      instansegLabels({ data: new Float32Array(4), height: 2, width: 2 }, 2, 2, post(3)),
    );
  });
});

describe("InstanSeg post-processing settings", () => {
  it("refuses a classifier with mismatched shapes", () => {
    assert.throws(() =>
      parsePostProcess({ classifier: [{ weights: [[1, 2], [3]], bias: [0, 0] }] }),
    );
    assert.throws(() => parsePostProcess({ classifier: [] }));
  });
});
