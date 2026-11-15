import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cellCoverage,
  learnerInput,
  pooledFeatureDims,
  poolNucleusFeature,
  typerLogProbabilities,
} from "../../src/index.ts";

function rampPlanes(channels: number, grid: number) {
  const plane = grid * grid;
  const data = new Float32Array(channels * plane);
  for (let channel = 0; channel < channels; channel++) {
    for (let cell = 0; cell < plane; cell++) data[channel * plane + cell] = channel * 100 + cell;
  }
  return { data, channels, grid };
}

const square = (x0: number, y0: number, x1: number, y1: number) =>
  Float32Array.of(x0, y0, x1, y0, x1, y1, x0, y1);

describe("pooling a nucleus from the embedding", () => {
  it("weights cells by how much of each the outline covers", () => {
    const coverage = cellCoverage(square(0, 0, 16, 8), 64, 4);
    assert.equal(coverage[0], 0.5);
    assert.equal(coverage[1], 0);
    assert.equal(coverage[4], 0);
  });

  it("averages the channels under the outline and over a two-cell ring around it", () => {
    const planes = rampPlanes(2, 8);
    const feature = poolNucleusFeature(planes, square(24, 24, 32, 32), 64);
    assert.equal(feature.length, pooledFeatureDims(2));
    assert.equal(feature[0], 27);
    assert.equal(feature[1], 127);
    assert.ok(Math.abs((feature[2] ?? 0) - 27) < 1e-4);
    assert.ok(Math.abs((feature[3] ?? 0) - 127) < 1e-4);
  });

  it("falls back to the centre cell for an outline smaller than every sample", () => {
    const planes = rampPlanes(1, 8);
    const feature = poolNucleusFeature(planes, square(9.1, 9.1, 9.2, 9.2), 64);
    assert.equal(feature[0], 9);
  });

  it("refuses an embedding smaller than its dims", () => {
    assert.throws(
      () =>
        poolNucleusFeature(
          { data: new Float32Array(3), channels: 1, grid: 2 },
          square(0, 0, 1, 1),
          2,
        ),
      RangeError,
    );
  });
});

describe("the typer's part of the input", () => {
  it("takes log probabilities in class order with a floor", () => {
    const logs = typerLogProbabilities({ tumor: 0.5, immune: 0 }, ["tumor", "stroma", "immune"]);
    assert.ok(Math.abs((logs[0] ?? 0) - Math.log(0.5)) < 1e-6);
    assert.ok(Math.abs((logs[1] ?? 0) - Math.log(1e-4)) < 1e-4);
    assert.ok(Math.abs((logs[2] ?? 0) - Math.log(1e-4)) < 1e-4);
  });

  it("uses a uniform answer without a typer and appends it after the pooled feature", () => {
    const logs = typerLogProbabilities(null, ["a", "b"]);
    assert.deepEqual(Array.from(logs), [Math.fround(Math.log(0.5)), Math.fround(Math.log(0.5))]);
    assert.deepEqual(Array.from(learnerInput(Float32Array.of(1, 2), logs)).slice(0, 2), [1, 2]);
    assert.equal(learnerInput(Float32Array.of(1, 2), logs).length, 4);
  });
});
