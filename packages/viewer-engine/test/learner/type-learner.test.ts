import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { argmax, createTypeLearner, seededRandom } from "../../src/index.ts";

function clusters(count: number, seed: number) {
  const random = seededRandom(seed);
  return Array.from({ length: count }, (_, index) => {
    const label = index % 2;
    const centre = label === 0 ? -2 : 2;
    return {
      key: `shape-${index}`,
      label,
      feature: Float32Array.of(centre + random() - 0.5, random() * 10, -centre + random() - 0.5),
    };
  });
}

describe("the per-slide type learner", () => {
  it("answers nothing until it has eight examples of two classes", () => {
    const learner = createTypeLearner(3, 4);
    for (const example of clusters(7, 1))
      learner.teach(example.key, example.feature, example.label);
    assert.equal(learner.ready, false);
    assert.equal(learner.train(), 0);
    assert.equal(learner.predict(Float32Array.of(0, 0, 0)), null);
    const sameClass = createTypeLearner(3, 4);
    for (let i = 0; i < 10; i++) sameClass.teach(`k${i}`, Float32Array.of(i, i, i), 2);
    assert.equal(sameClass.ready, false);
  });

  it("learns two separable classes and gives no weight to classes it never saw", () => {
    const learner = createTypeLearner(3, 4);
    for (const example of clusters(40, 2))
      learner.teach(example.key, example.feature, example.label);
    assert.ok(learner.train() > 0);
    const left = learner.predict(Float32Array.of(-2, 5, 2));
    const right = learner.predict(Float32Array.of(2, 5, -2));
    assert.equal(argmax(left ?? []), 0);
    assert.equal(argmax(right ?? []), 1);
    assert.equal(left?.[2], 0);
    assert.equal(left?.[3], 0);
    const total = Array.from(left ?? []).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(total - 1) < 1e-5);
  });

  it("replaces a shape's earlier correction and forgets a removed one", () => {
    const learner = createTypeLearner(3, 4);
    learner.teach("a", Float32Array.of(1, 1, 1), 0);
    learner.teach("a", Float32Array.of(2, 2, 2), 1);
    assert.equal(learner.count, 1);
    assert.equal(learner.examples()[0]?.label, 1);
    assert.equal(learner.forget("a"), true);
    assert.equal(learner.forget("a"), false);
    assert.equal(learner.count, 0);
  });

  it("does not keep a reference to the caller's feature", () => {
    const learner = createTypeLearner(2, 2);
    const feature = Float32Array.of(1, 2);
    learner.teach("a", feature, 0);
    feature[0] = 9;
    assert.equal(learner.examples()[0]?.feature[0], 1);
  });

  it("refuses a feature of the wrong length or a class outside the set", () => {
    const learner = createTypeLearner(3, 4);
    assert.throws(() => learner.teach("a", Float32Array.of(1, 2), 0), RangeError);
    assert.throws(() => learner.teach("a", Float32Array.of(1, 2, 3), 4), RangeError);
    assert.throws(() => createTypeLearner(3, 1), RangeError);
  });

  it("warms up from the last weights after one more correction", () => {
    const learner = createTypeLearner(3, 4, { fullIterations: 150, warmIterations: 25 });
    const examples = clusters(41, 3);
    for (const example of examples.slice(0, 40))
      learner.teach(example.key, example.feature, example.label);
    assert.equal(learner.train(), 150);
    const last = examples[40];
    if (last !== undefined) learner.teach(last.key, last.feature, last.label);
    assert.equal(learner.train(), 25);
  });
});
