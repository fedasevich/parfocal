import assert from "node:assert/strict";
import { test } from "node:test";
import type { CountsAsChange, Evaluation, ReviewDecision } from "@parfocal/api-client";
import { methodsLines } from "../src/screens/evaluation/numbers.ts";
import { recountOf, recountText, splitOf } from "../src/screens/project/task-settings-model.ts";
import {
  countsAsList,
  decisionBody,
  decisionSettings,
  rawOfDecision,
  toReviewStyle,
} from "../src/screens/review/decision-mapping.ts";

const certainty = toReviewStyle({
  style: "certainty",
  counts_as: ["disagree", "disagree", "unsure", "agree", "agree"],
});

const classes = [
  { id: "c-tumor", name: "Tumor", color: "#f87171" },
  { id: "c-stroma", name: "Stroma", color: "#6ee7b7" },
];

test("the task's counts-as list becomes the agree and disagree boundaries", () => {
  assert.deepEqual(
    [certainty.kind, certainty.agreeFrom, certainty.disagreeTo],
    ["certainty", 4, 2],
  );
  const wide = toReviewStyle({
    style: "yes-no",
    counts_as: ["disagree", "unsure", "unsure", "agree", "agree"],
    question: "Is this tumor?",
  });
  assert.deepEqual(
    [wide.kind, wide.agreeFrom, wide.disagreeTo, wide.question],
    ["yesno", 4, 1, "Is this tumor?"],
  );
});

test("settings sent to the API round-trip through the boundaries", () => {
  const settings = decisionSettings("certainty", { agreeFrom: 5, disagreeTo: 2 });
  assert.equal(settings.style, "certainty");
  assert.deepEqual(settings.counts_as, ["disagree", "disagree", "unsure", "unsure", "agree"]);
  assert.deepEqual(countsAsList(3, 1), ["disagree", "unsure", "agree", "agree", "agree"]);
  const back = toReviewStyle(settings);
  assert.deepEqual([back.agreeFrom, back.disagreeTo], [5, 2]);
  assert.equal(
    decisionSettings("yesno", { agreeFrom: 4, disagreeTo: 2 }, "Is it?").question,
    "Is it?",
  );
  assert.equal(decisionSettings("agree", { agreeFrom: 4, disagreeTo: 2 }, "Is it?").question, null);
});

test("each style saves the answer the API accepts for it", () => {
  assert.deepEqual(
    decisionBody(toReviewStyle({ style: "agree" }), "disagree", classes, "disagree"),
    {
      value: "disagree",
    },
  );
  assert.deepEqual(decisionBody(certainty, "4", classes, "agree"), { answer: "4" });
  assert.deepEqual(decisionBody(certainty, "unsure", classes, "unsure"), { answer: "unsure" });
  const blind = toReviewStyle({ style: "blind" });
  assert.deepEqual(decisionBody(blind, "Stroma", classes, "disagree"), {
    answer: "class",
    answer_class_id: "c-stroma",
  });
  assert.deepEqual(decisionBody(blind, "unsure", classes, "unsure"), { answer: "unsure" });
});

const stored = (patch: Partial<ReviewDecision>): ReviewDecision => ({
  object: "T2",
  kind: "region",
  number: 2,
  style: "certainty",
  answer: "5",
  answer_class_id: null,
  value: "agree",
  reasons: [],
  reason_class_id: null,
  note: null,
  updated_at: "2026-11-02T10:00:00+01:00",
  ...patch,
});

test("a stored decision gives back the raw answer as pressed", () => {
  assert.equal(rawOfDecision(certainty, stored({}), classes, undefined), "5");
  const blind = toReviewStyle({ style: "blind" });
  assert.equal(
    rawOfDecision(
      blind,
      stored({ style: "blind", answer: "class", answer_class_id: "c-stroma", value: "disagree" }),
      classes,
      undefined,
    ),
    "Stroma",
  );
  assert.equal(
    rawOfDecision(certainty, stored({ style: "agree", answer: "agree" }), classes, undefined),
    "4",
  );
});

const evaluation = {
  decisions: {
    style: "certainty",
    counts_as: ["disagree", "disagree", "unsure", "agree", "agree"],
    counted: { agree: 5, disagree: 2, unsure: 1 },
    answers: { "1": 1, "2": 1, "3": 1, "4": 2, "5": 3 },
  },
} as unknown as Evaluation;

test("the Methods lines name the style, the counts and each Counts as change", () => {
  const change: CountsAsChange = {
    changed_at: "2026-11-03T09:00:00+01:00",
    changed_by_user_id: "u1",
    before: ["disagree", "disagree", "unsure", "agree", "agree"],
    after: ["disagree", "unsure", "unsure", "unsure", "agree"],
    recounted: 8,
    reasons_dropped: 0,
  };
  const lines = methodsLines(evaluation, [change], () => "Daniel Hruška");
  assert.match(lines[0] ?? "", /5-point certainty style\. 4 and 5 count as agree/);
  assert.match(lines[1] ?? "", /5 agree, 2 disagree, 1 not sure/);
  assert.match(lines[1] ?? "", /1 1, 2 1, 3 1, 4 2, 5 3/);
  assert.match(lines[2] ?? "", /Daniel Hruška changed Counts as on 3 November 2026/);
  assert.match(lines[2] ?? "", /8 recounted/);
  assert.equal(methodsLines(evaluation, [], () => "").length, 2);
});

test("a Counts as edit recounts only the answers whose value changes", () => {
  const answers = { "1": 2, "2": 4, "3": 5, "4": 8, "5": 9 };
  const from = { agreeFrom: 4, disagreeTo: 2 };
  assert.deepEqual(recountOf(answers, from, { agreeFrom: 5, disagreeTo: 2 }), {
    total: 28,
    changed: 8,
  });
  assert.deepEqual(recountOf(answers, from, { agreeFrom: 4, disagreeTo: 1 }), {
    total: 28,
    changed: 4,
  });
  assert.deepEqual(recountOf(answers, from, from), { total: 28, changed: 0 });
  assert.deepEqual(splitOf(answers, { agreeFrom: 5, disagreeTo: 2 }), {
    agree: 9,
    unsure: 13,
    disagree: 6,
  });
  assert.equal(recountText({ total: 28, changed: 8 }), "Recounts 8 of 28 answers.");
  assert.match(recountText({ total: 0, changed: 0 }), /nothing is recounted/);
});
