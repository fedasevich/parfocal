import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewObject } from "@parfocal/api-client";
import { agreeWithTheAi } from "../src/screens/review/decision-mapping.ts";
import { cardText, shownCode } from "../src/screens/review/decision-style.ts";

const object = (extra: Partial<ReviewObject>): ReviewObject => ({
  object: "T7",
  kind: "region",
  number: 7,
  class_name: "Tumor",
  score: 0,
  size_mm: null,
  other_class: null,
  ...extra,
});

test("a drawn outline shows its person mark and says who drew it with which tool", () => {
  const drawn = object({ drawn: true, tool: "smart-select" });
  assert.equal(shownCode(drawn), "T7⁺");
  const text = cardText(agreeWithTheAi, drawn, "number");
  assert.equal(text.question, "A person drew T7⁺ with Smart select as tumor.");
  assert.equal(text.chip, null);
  assert.equal(
    cardText(agreeWithTheAi, object({ drawn: true, tool: "hand" }), "number").question,
    "A person drew T7⁺ by hand as tumor.",
  );
});

test("an AI object keeps its plain code and the AI's claim", () => {
  const ai = object({ score: 0.9 });
  assert.equal(shownCode(ai), "T7");
  assert.match(cardText(agreeWithTheAi, ai, "number").question, /^The AI says T7 is tumor/);
});
