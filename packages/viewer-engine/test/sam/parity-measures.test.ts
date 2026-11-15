import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bestMultimask,
  maskIou,
  maxAbsDifference,
  mean,
  planeIou,
} from "../../sam-bench/page/parity-measures.ts";

describe("browser parity measures", () => {
  it("takes the largest absolute difference and refuses mismatched lengths", () => {
    assert.equal(maxAbsDifference(Float32Array.of(1, -2, 3), Float32Array.of(1.5, 1, 3)), 3);
    assert.throws(() => maxAbsDifference(Float32Array.of(1), Float32Array.of(1, 2)));
  });

  it("scores a stored mask against one plane of decoder logits", () => {
    const expected = Uint8Array.of(1, 1, 0, 0);
    const logits = Float32Array.of(9, 9, 9, 9, 2, -1, 3, -4);
    assert.equal(maskIou(expected, logits, 4, 0), 1 / 3);
    assert.equal(maskIou(Uint8Array.of(0, 0), Float32Array.of(-1, -1), 0, 0), 1);
  });

  it("thresholds only the first plane of AIS maps", () => {
    const expected = Float32Array.of(0.9, 0.9, 0.1, 0.9);
    const got = Float32Array.of(0.8, 0.2, 0.1, 0);
    assert.equal(planeIou(expected, got, 2, 0.5), 0.5);
  });

  it("picks the best multimask output and never the single mask", () => {
    assert.equal(bestMultimask(Float32Array.of(0.99, 0.4, 0.7, 0.7)), 2);
    assert.equal(bestMultimask(Float32Array.of(0.1, 0.5, 0.2, 0.3)), 1);
  });

  it("averages", () => {
    assert.equal(mean([1, 2, 3]), 2);
  });
});
