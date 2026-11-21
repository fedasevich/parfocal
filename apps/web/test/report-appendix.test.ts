import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueueRow } from "@parfocal/api-client";
import { decisionCell, reviewerCells } from "../src/screens/evaluation/appendix.ts";
import { toReviewStyle } from "../src/screens/review/decision-mapping.ts";

const answered = (object: string, raw: string, decided: string | null): QueueRow => ({
  key: object,
  slide_id: "s1",
  slide_label: "A1",
  object,
  kind: "cell",
  ai: { class_name: "Stroma cell", score: 0.8 },
  size_mm: 0.01,
  tag: "bothai",
  answers: [{ user_id: "u1", raw, reason: null, note: null }],
  state: decided === null ? "open" : "decided",
  decision:
    decided === null
      ? null
      : { raw: decided, note: null, by_user_id: "u2", at: "2026-11-21T10:00:00Z" },
  adjudicator: null,
  edited: null,
});

test("the appendix names agreed, disagreed and unsure objects by the five step scale", () => {
  const style = toReviewStyle({
    style: "certainty",
    counts_as: ["disagree", "disagree", "unsure", "agree", "agree"],
  });
  const rows = [answered("C1", "5", "5"), answered("C2", "1", "1"), answered("C3", "3", null)];
  assert.deepEqual(
    rows.map((row) => [reviewerCells(row, ["u1"], style)[0], decisionCell(row, style)]),
    [
      ["5 · Certainly", "5 · Certainly"],
      ["1 · Certainly not", "1 · Certainly not"],
      ["3 · Can't tell", null],
    ],
  );
});

test("the appendix names agreed, disagreed and unsure objects with agree or disagree", () => {
  const style = toReviewStyle({ style: "agree" });
  const rows = [
    answered("C1", "agree", "agree"),
    answered("C2", "disagree", "disagree"),
    answered("C3", "unsure", "unsure"),
  ];
  assert.deepEqual(
    rows.map((row) => [...reviewerCells(row, ["u1", "u9"], style), decisionCell(row, style)]),
    [
      ["Agree", "", "Agree"],
      ["Disagree", "", "Disagree"],
      ["Not sure", "", "Not sure"],
    ],
  );
});
