import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DETECTOR_SCORE_FLOOR,
  FOREGROUND_FLOOR,
  mayNotBeNucleus,
} from "../src/lib/not-a-nucleus.ts";

test("the cut-offs are 0.8 for the detector score and 0.5 for the foreground share", () => {
  assert.equal(DETECTOR_SCORE_FLOOR, 0.8);
  assert.equal(FOREGROUND_FLOOR, 0.5);
});

test("a detector score under 0.8 flags the nucleus", () => {
  assert.equal(mayNotBeNucleus({ detectorScore: 0.79, foreground: 0.9 }), true);
  assert.equal(mayNotBeNucleus({ detectorScore: 0 }), true);
});

test("a foreground share under 0.5 flags the nucleus", () => {
  assert.equal(mayNotBeNucleus({ detectorScore: 0.95, foreground: 0.49 }), true);
  assert.equal(mayNotBeNucleus({ foreground: 0 }), true);
});

test("either test firing is enough and both firing still flags", () => {
  assert.equal(mayNotBeNucleus({ detectorScore: 0.5, foreground: 0.2 }), true);
});

test("a score of exactly 0.8 and a share of exactly 0.5 do not flag", () => {
  assert.equal(mayNotBeNucleus({ detectorScore: 0.8, foreground: 0.5 }), false);
});

test("clear nuclei are not flagged", () => {
  assert.equal(mayNotBeNucleus({ detectorScore: 0.93, foreground: 0.88 }), false);
});

test("a missing measure never flags on its own", () => {
  assert.equal(mayNotBeNucleus({}), false);
  assert.equal(mayNotBeNucleus({ detectorScore: null, foreground: null }), false);
  assert.equal(mayNotBeNucleus({ detectorScore: 0.9 }), false);
  assert.equal(mayNotBeNucleus({ foreground: 0.7 }), false);
});
