import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewObject } from "@parfocal/api-client";
import { rowCode, rowLabel } from "../src/screens/disagreements/text.ts";
import { agreeWithTheAi } from "../src/screens/review/decision-mapping.ts";
import {
  cardText,
  drawnByText,
  scoreShown,
  shownCode,
} from "../src/screens/review/decision-style.ts";

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

test("the queue shows a drawn outline with its person mark and an AI object without", () => {
  assert.equal(rowCode({ object: "T7", drawn: true }), "T7⁺");
  assert.equal(rowLabel({ object: "T7", slide_label: "B2", drawn: true }), "T7⁺ on B2");
  assert.equal(rowLabel({ object: "T7", slide_label: "A1" }), "T7");
});

const ada = "8f0e2a4c-1b7d-4c3e-9a5f-0d2b6e8c1a3f";
const ben = "2c4e6a8b-0d1f-4a3c-8e5b-7f9a1c3e5d7b";
const names: Record<string, string> = { [ada]: "Ada", [ben]: "Ben" };

test("the viewer names who drew the outlines and with which tool, from the API's objects", () => {
  const objects = [
    object({ drawn: true, drawn_by_user_id: ada, tool: "hand" }),
    object({ object: "T8", number: 8, drawn: true, drawn_by_user_id: ben, tool: "smart-select" }),
    object({ object: "T9", number: 9, drawn: true, drawn_by_user_id: ada, tool: "hand" }),
  ];
  assert.equal(
    drawnByText(objects, (id) => names[id]),
    "Ada by hand, Ben with Smart select",
  );
  assert.equal(
    drawnByText([object({ drawn: true, drawn_by_user_id: null, tool: null })], () => undefined),
    "A person",
  );
});

test("a drawn outline shows no score, an AI object keeps its own", () => {
  assert.equal(
    scoreShown(object({ drawn: true, drawn_by_user_id: ada, tool: "hand" }), true),
    false,
  );
  assert.equal(scoreShown(object({ score: 0.91 }), true), true);
  assert.equal(scoreShown(object({ score: 0.91 }), false), false);
});

test("an AI object keeps its plain code and the AI's claim", () => {
  const ai = object({ score: 0.9 });
  assert.equal(shownCode(ai), "T7");
  assert.match(cardText(agreeWithTheAi, ai, "number").question, /^The AI says T7 is tumor/);
});
