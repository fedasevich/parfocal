import assert from "node:assert/strict";
import { test } from "node:test";
import type { AdjudicationObject } from "@parfocal/api-client";
import {
  adjudicatorCard,
  allDecidedHeading,
  decidedRows,
  sentNoteLine,
} from "../src/screens/disagreements/adjudicator-card.ts";
import { agreeWithTheAi, type ReviewStyle } from "../src/screens/review/decision-mapping.ts";

const object = (patch: Partial<AdjudicationObject> = {}): AdjudicationObject => ({
  key: "A1:T4",
  slide_id: "s1",
  slide_label: "A1",
  object: "T4",
  kind: "region",
  ai: { class_name: "Tumor", score: 0.58 },
  size_mm: 0.75,
  reviewer_a: { raw: "agree", reason: null, note: null },
  reviewer_b: { raw: "disagree", reason: "Not tumor", note: "Reactive sinus histiocytes." },
  decision: null,
  decision_note: null,
  ...patch,
});

const agree = { style: agreeWithTheAi, classes: [] };
const yesNo: ReviewStyle = { ...agreeWithTheAi, kind: "yesno", question: "Is this tumor?" };

test("reviewers who differ are explained and shown only as letters", () => {
  const card = adjudicatorCard(object(), agree, "number");
  assert.equal(card.why, "One reviewer agrees with the AI, the other disagrees with the AI");
  assert.deepEqual(
    card.reviewers.map((line) => [line.letter, line.text, line.tone, line.note]),
    [
      ["A", "Agree", "ok", null],
      ["B", "Disagree · not tumor", "bad", "Reactive sinus histiocytes."],
    ],
  );
  assert.doesNotMatch(JSON.stringify(card), /user_id|avatar/);
});

test("two reviewers against the AI say so", () => {
  const card = adjudicatorCard(
    object({
      reviewer_a: { raw: "disagree", reason: "It is an immune cell", note: null },
      reviewer_b: { raw: "disagree", reason: "It is an immune cell", note: null },
    }),
    agree,
    "number",
  );
  assert.equal(card.why, "Both reviewers disagree with the AI");
});

test("a second look asked by one reviewer names the other reviewer's answer", () => {
  const card = adjudicatorCard(
    object({
      reviewer_a: { raw: "unsure", reason: "Need a second look", note: null },
      reviewer_b: { raw: "disagree", reason: "Not tumor", note: null },
    }),
    agree,
    "number",
  );
  assert.equal(card.why, "One reviewer asked for a second look, the other disagrees with the AI");
  assert.equal(card.reviewers[0]?.text, "Not sure · second look");
});

test("the AI's line follows the confidence setting", () => {
  assert.equal(
    adjudicatorCard(object(), agree, "number").headline,
    "The AI says T4 is tumor, 58% sure.",
  );
  assert.equal(
    adjudicatorCard(object(), agree, "word").headline,
    "The AI says T4 is tumor, 58% sure.",
  );
  assert.equal(adjudicatorCard(object(), agree, "hidden").headline, "The AI says T4 is tumor.");
  assert.equal(
    adjudicatorCard(object(), agree, "color").sub,
    "Confidence as a color · 0.8 mm across",
  );
});

test("a cell has no size and says it is in the sample", () => {
  const card = adjudicatorCard(
    object({ object: "T1·C145", kind: "cell", size_mm: null }),
    agree,
    "number",
  );
  assert.equal(card.headline, "The AI says this is a tumor cell, only 58% sure.");
  assert.equal(card.sub, "Cell in the sample");
});

test("a task that hides the AI's claim shows no class or score", () => {
  const card = adjudicatorCard(
    object({
      reviewer_a: { raw: "yes", reason: null, note: null },
      reviewer_b: { raw: "no", reason: null, note: null },
    }),
    { style: yesNo, classes: [] },
    "number",
  );
  assert.equal(card.hiddenNote, "The AI's claim is hidden in this task");
  assert.equal(card.headline, "Is this tumor?");
  assert.doesNotMatch(JSON.stringify(card), /58/);
});

test("once every object is decided the heading says so and names who is told", () => {
  const rows = decidedRows(
    [
      object({ decision: "disagree" }),
      object({ object: "T5", decision: "agree" }),
      object({ object: "T1·C145", kind: "cell", decision: "unsure" }),
    ],
    agree,
  );
  assert.deepEqual(
    rows.map((row) => [row.object, row.word, row.tone]),
    [
      ["T4", "Disagree", "bad"],
      ["T5", "Agree", "ok"],
      ["T1·C145", "Not sure", "warn"],
    ],
  );
  assert.equal(allDecidedHeading(rows.length, "Daniel"), "All 3 decided. Daniel is told.");
});

test("the researcher's note on the send shows only when there is one", () => {
  assert.equal(
    sentNoteLine("Daniel", "Please look at the edges"),
    "Daniel wrote: Please look at the edges",
  );
  assert.equal(sentNoteLine("Daniel", null), null);
});
