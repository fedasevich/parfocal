import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { tierChoices } from "../src/aiseg/one-click-tiers.ts";
import {
  modelNotLoadedText,
  modelNotStartedText,
  plainFailure,
} from "../src/aiseg/plain-message.ts";
import { fallbackWords, stateWordOf } from "../src/annotations/smart-status.ts";

describe("the words a compact bar shows in place of a sentence", () => {
  it("shortens every message the model can give to a word of at most twelve letters", () => {
    for (const message of [
      modelNotStartedText,
      modelNotLoadedText,
      "This area has no pixels yet",
      "This area is too small for smart select",
      "Smart select could not outline that",
      "Smart select could not start",
      "No outline found",
      "Outside the area being refined",
      plainFailure(new Error("x"), "Auto region could not run"),
    ]) {
      const word = stateWordOf(message);
      assert.ok(word.length <= 12, `${message} became ${word}`);
      assert.notEqual(word, message);
    }
    assert.equal(stateWordOf(modelNotStartedText), "Not running");
  });

  it("says Good was used for every reason Best did not answer", () => {
    assert.deepEqual(new Set(Object.values(fallbackWords)), new Set(["Good used"]));
    assert.deepEqual(Object.keys(fallbackWords).sort(), [
      "cancelled",
      "gave-up",
      "offline",
      "refused",
      "unsendable",
    ]);
  });
});

describe("the models the bar picker offers", () => {
  it("lists Best then Good with a description, what runs it and the cost", () => {
    const choices = tierChoices(true);
    assert.deepEqual(
      choices.map((choice) => choice.tier),
      ["best", "good"],
    );
    for (const choice of choices) {
      assert.ok(choice.description.length > 0);
      assert.equal(choice.makes.length, 2);
      assert.match(choice.cost, /^(Slower|Quicker) · \d+ MB$/);
    }
    assert.match(choices[0]?.cost ?? "", /^Slower/);
    assert.match(choices[1]?.cost ?? "", /^Quicker/);
    assert.equal(tierChoices(false)[1]?.makes[1], "Processor");
    assert.equal(tierChoices(true)[1]?.makes[1], "Graphics card");
  });
});
