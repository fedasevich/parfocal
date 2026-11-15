import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  argmax,
  createTypeLearner,
  learnerInput,
  readSavedLearner,
  restoreLearner,
  saveLearner,
  type TypeLearner,
} from "../../src/index.ts";
import { syntheticSlide } from "./synthetic-slide.ts";

const classKeys = ["tumor", "stroma", "immune", "other"];

function trainedOnSlide(): { learner: TypeLearner; inputs: Float32Array[] } {
  const slide = syntheticSlide({ nuclei: 300 });
  const inputs = slide.features.map((feature, index) =>
    learnerInput(feature, slide.typerLogs[index] ?? new Float32Array(4)),
  );
  const learner = createTypeLearner(inputs[0]?.length ?? 0, 4);
  inputs.slice(0, 200).forEach((input, index) => {
    learner.teach(`shape-${index}`, input, slide.labels[index] ?? 0);
  });
  learner.train();
  return { learner, inputs };
}

describe("the saved learner", () => {
  it("survives JSON and types the slide as before", () => {
    const { learner, inputs } = trainedOnSlide();
    const saved = readSavedLearner(JSON.parse(JSON.stringify(saveLearner(learner, classKeys))));
    assert.ok(saved !== null);
    const restored = restoreLearner(saved, learner.dims, classKeys);
    assert.ok(restored !== null);
    assert.equal(restored.count, 200);
    let same = 0;
    const held = inputs.slice(200);
    for (const input of held) {
      if (argmax(learner.predict(input) ?? []) === argmax(restored.predict(input) ?? [])) same++;
    }
    assert.ok(same / held.length >= 0.9, `${same} of ${held.length} kept their class`);
  });

  it("is smaller than the features written as JSON numbers", () => {
    const { learner } = trainedOnSlide();
    const saved = JSON.stringify(saveLearner(learner, classKeys));
    const plain = JSON.stringify(learner.examples().map((example) => Array.from(example.feature)));
    assert.ok(saved.length < plain.length / 2, `${saved.length} against ${plain.length}`);
  });

  it("maps labels by class key and drops examples of a class that is gone", () => {
    const learner = createTypeLearner(2, 3, { minExamples: 1 });
    learner.teach("a", Float32Array.of(0, 1), 0);
    learner.teach("b", Float32Array.of(1, 0), 2);
    const saved = saveLearner(learner, ["tumor", "stroma", "immune"]);
    const restored = restoreLearner(saved, 2, ["immune", "tumor"]);
    assert.ok(restored !== null);
    assert.deepEqual(
      restored.examples().map((example) => [example.key, example.label]),
      [
        ["a", 1],
        ["b", 0],
      ],
    );
    const narrowed = restoreLearner(saved, 2, ["immune", "other"]);
    assert.deepEqual(
      narrowed?.examples().map((example) => example.key),
      ["b"],
    );
  });

  it("is discarded when the feature size or the format changed", () => {
    const { learner } = trainedOnSlide();
    const saved = saveLearner(learner, classKeys);
    assert.equal(restoreLearner(saved, learner.dims + 1, classKeys), null);
    assert.equal(readSavedLearner({ ...saved, version: 2 }), null);
    assert.equal(readSavedLearner({ ...saved, variant: "prior" }), null);
    assert.equal(readSavedLearner({ ...saved, labels: [] }), null);
    assert.equal(readSavedLearner("learner"), null);
    assert.equal(restoreLearner({ ...saved, values: "AAAA" }, learner.dims, classKeys), null);
  });

  it("saves an empty learner", () => {
    const learner = createTypeLearner(3, 2);
    const restored = restoreLearner(saveLearner(learner, ["a", "b"]), 3, ["a", "b"]);
    assert.equal(restored?.count, 0);
  });
});
