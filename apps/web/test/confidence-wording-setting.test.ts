import assert from "node:assert/strict";
import { test } from "node:test";
import { type ReviewObject, settingsCatalogue, type TaskDisplay } from "@parfocal/api-client";
import type { TyperEvidence } from "@parfocal/ui/lib/confidence-words";
import { reviewConfidence, sureText } from "../src/screens/review/ai-wording.ts";
import { sectionRows } from "../src/screens/settings/sections.ts";
import { wordingNow, wordingPairs } from "../src/screens/settings/wording-row.ts";

const display: TaskDisplay = {
  task_id: "t1",
  task_code: "T-1",
  locks: [],
  presets: [{ name: "Dots", key: "2", settings: { confidence: "number" } }],
};

const empty = { lab: { values: {}, locked: [] }, personal: {}, device: {} };

const cell: ReviewObject = {
  object: "T1·C145",
  kind: "cell",
  number: 145,
  class_name: "Tumor",
  score: 0.72,
  size_mm: null,
  other_class: null,
};

const measured: TyperEvidence = {
  name: "Measured typer",
  calibrated: true,
  checkedOnHeldOut: true,
  bandAccuracy: { likely: 0.72 },
};

test("Settings shows the confidence wording row with every value of the setting", () => {
  const row = sectionRows.ai.find((item) => item.key === "confidenceWording");
  assert.equal(row?.label, "Confidence wording");
  assert.equal(row?.scope, "personal");
  assert.deepEqual(wordingPairs, [
    ["words", "Words"],
    ["numbers", "Numbers"],
    ["frequency", "Frequency"],
    ["colour", "Colour"],
    ["hidden", "Hidden"],
  ]);
  assert.deepEqual(
    wordingPairs.map(([value]) => value),
    settingsCatalogue.confidence_wording.options,
  );
});

test("the row shows words until a personal value is saved", () => {
  assert.equal(wordingNow(empty), "words");
  assert.equal(
    wordingNow({ ...empty, personal: { confidence_wording: "frequency" } }),
    "frequency",
  );
});

test("guided review follows the setting when the task locks nothing", () => {
  assert.equal(reviewConfidence(display, null, [], "words"), "word");
  assert.equal(reviewConfidence(display, null, [], "numbers"), "number");
  assert.equal(reviewConfidence(display, null, [], "frequency"), "frequency");
  assert.equal(reviewConfidence(display, null, [], "colour"), "color");
  assert.equal(reviewConfidence(display, null, [], "hidden"), "hidden");
});

test("a preset the reviewer picked or a lock on the task keeps its own confidence", () => {
  assert.equal(reviewConfidence(display, "Dots", [], "words"), "number");
  const locked: TaskDisplay = {
    ...display,
    locks: [{ setting: "confidence", value: "colour", reason: "Blind round" }],
  };
  assert.equal(reviewConfidence(locked, null, [], "words"), "color");
  const hiddenHere = [{ setting: "confidence", value: "hidden" }];
  assert.equal(reviewConfidence(display, "Dots", hiddenHere, "numbers"), "hidden");
});

test("the review card words the call by the chosen frequency", () => {
  assert.equal(sureText(cell, "frequency", measured), ", right about 7 in 10 times");
  assert.equal(sureText(cell, "frequency"), ", only 72% sure");
  assert.equal(
    sureText(cell, "frequency", { ...measured, bandAccuracy: {} }),
    ", not measured at this confidence",
  );
});
