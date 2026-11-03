import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewObject } from "@parfocal/api-client";
import type { TyperEvidence } from "@parfocal/ui/lib/confidence-words";
import { sureText } from "../src/screens/review/ai-wording.ts";

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

test("the review card words the AI call through the wording module", () => {
  assert.equal(sureText(cell, "number"), ", only 72% sure");
  assert.equal(sureText(cell, "word", measured), ", fairly sure");
  assert.equal(sureText(cell, "color", measured), "");
  assert.equal(sureText(cell, "hidden", measured), "");
});

test("word confidence falls back to the percent for an uncalibrated typer", () => {
  assert.equal(sureText(cell, "word"), ", only 72% sure");
  assert.equal(sureText({ ...cell, kind: "region", score: 0.9 }, "word"), ", 90% sure");
});
