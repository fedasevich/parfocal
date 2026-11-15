import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  balancedAccuracy,
  protocolCorrections,
  protocolDraws,
  sameImageProtocol,
  sameImageTrial,
} from "../../src/index.ts";
import { syntheticSlide } from "./synthetic-slide.ts";

describe("balanced accuracy", () => {
  it("averages recall over the classes that are present", () => {
    assert.equal(balancedAccuracy([0, 0, 1, 1], [0, 0, 1, 0], 4), (2 / 3 + 1) / 2);
    assert.equal(balancedAccuracy([], [], 4), 0);
  });
});

describe("the same-image protocol of doc 22", () => {
  it("raises same-image balanced accuracy by at least 10 points after 200 corrections", () => {
    const slide = syntheticSlide();
    const score = sameImageProtocol(slide);
    assert.equal(score.corrections, protocolCorrections);
    assert.equal(score.trials.length, protocolDraws);
    assert.ok(score.typer < 0.6, `the synthetic typer should be weak, got ${score.typer}`);
    assert.ok(
      score.gain >= 0.1,
      `typer ${score.typer.toFixed(3)}, learner ${score.learner.toFixed(3)}, gain ${score.gain.toFixed(3)}`,
    );
  });

  it("keeps the typer's answer when too few corrections came in to train", () => {
    const slide = syntheticSlide({ nuclei: 400 });
    const held = Array.from({ length: 300 }, (_, index) => index + 100);
    const trial = sameImageTrial(slide, [0, 1, 2], held);
    assert.equal(trial.learner, trial.typer);
  });

  it("gives the same score for the same seed", () => {
    const slide = syntheticSlide({ nuclei: 800 });
    const options = { corrections: 100, draws: 1, held: 500, seed: 3 };
    const first = sameImageProtocol(slide, options);
    const second = sameImageProtocol(slide, options);
    assert.equal(first.learner, second.learner);
  });
});
