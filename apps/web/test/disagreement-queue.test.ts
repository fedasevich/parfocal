import assert from "node:assert/strict";
import { test } from "node:test";
import type { QueueRow } from "@parfocal/api-client";
import {
  allClosed,
  canSend,
  countOf,
  filterCounts,
  filterRows,
  isClosed,
  nextOpen,
  rowTag,
  styledText,
  styledWord,
} from "../src/screens/disagreements/text.ts";
import { toReviewStyle } from "../src/screens/review/decision-mapping.ts";

const names: Record<string, string> = {
  u1: "Lukas Marek",
  u2: "Simona Markova",
  u3: "Anna Kopecka",
};
const nameOf = (id: string | null | undefined) => (id ? names[id] : undefined);

const row = (key: string, patch: Partial<QueueRow> = {}): QueueRow => ({
  key,
  slide_id: "s1",
  slide_label: "A1",
  object: key,
  kind: "region",
  ai: { class_name: "Tumor", score: 0.9 },
  size_mm: 2,
  tag: "differ",
  answers: [
    { user_id: "u1", raw: "agree", reason: null, note: null },
    { user_id: "u2", raw: "disagree", reason: null, note: null },
  ],
  state: "open",
  decision: null,
  adjudicator: null,
  edited: null,
  ...patch,
});

const decision = (raw: string) => ({
  raw,
  note: null,
  by_user_id: "u3",
  at: "2026-11-04T10:00:00Z",
});

const rows = [
  row("T2"),
  row("T4", { tag: "second" }),
  row("T5", { tag: "bothai" }),
  row("T6", { tag: "bothai" }),
];

const classes = [
  { id: "c1", name: "Tumor", color: "#f87171" },
  { id: "c2", name: "Stroma", color: "#6ee7b7" },
];

const certaintyCounts = ["disagree", "disagree", "unsure", "agree", "agree"] as const;

test("each filter lists its rows and second look rows count as reviewers differ", () => {
  assert.deepEqual(filterCounts(rows), { all: 4, rev: 2, ai: 2 });
  assert.deepEqual(
    filterRows(rows, "all").map((item) => item.key),
    ["T2", "T4", "T5", "T6"],
  );
  assert.deepEqual(
    filterRows(rows, "rev").map((item) => item.key),
    ["T2", "T4"],
  );
  assert.deepEqual(
    filterRows(rows, "ai").map((item) => item.key),
    ["T5", "T6"],
  );
});

test("a decision reads in the words of each decision style and counts as agree, disagree or unsure", () => {
  const agree = toReviewStyle({ style: "agree" });
  const yesno = toReviewStyle({ style: "yes-no", question: "Is this tumor?" });
  const certainty = toReviewStyle({ style: "certainty", counts_as: [...certaintyCounts] });
  const blind = toReviewStyle({ style: "blind" });
  const word = (style: typeof agree, raw: string) => styledWord(style, raw, classes, "Tumor");
  assert.equal(word(agree, "disagree"), "Disagree");
  assert.equal(word(yesno, "yes"), "Yes");
  assert.equal(word(certainty, "4"), "4 · Probably");
  assert.equal(word(blind, "Stroma"), "Stroma");
  assert.equal(word(blind, "unsure"), "Not sure");
  assert.equal(countOf(agree, "disagree", "Tumor"), "disagree");
  assert.equal(countOf(yesno, "yes", "Tumor"), "agree");
  assert.equal(countOf(yesno, "no", "Tumor"), "disagree");
  assert.equal(countOf(certainty, "3", "Tumor"), "unsure");
  assert.equal(countOf(certainty, "5", "Tumor"), "agree");
  assert.equal(countOf(blind, "Tumor", "Tumor"), "agree");
  assert.equal(countOf(blind, "Stroma", "Tumor"), "disagree");
  assert.equal(
    styledText(agree, { raw: "unsure", reason: "Need a second look" }, classes, "Tumor"),
    "Not sure · second look",
  );
});

test("a decided row reads in the task style and the queue moves to the next open row", () => {
  const style = toReviewStyle({ style: "certainty", counts_as: [...certaintyCounts] });
  const decided = row("T2", { state: "decided", decision: decision("2") });
  assert.deepEqual(rowTag(decided, nameOf, { style, classes }), {
    label: "2 · Probably not",
    tone: "bad",
  });
  const list = [decided, ...rows.slice(1)];
  assert.equal(nextOpen(list, decided)?.key, "T4");
  const allLeft = list.map((item) => ({ ...item, state: "left-open" as const }));
  assert.equal(nextOpen(allLeft, allLeft[0] as QueueRow), undefined);
});

test("a row left open is closed, shows its tag and can still go to an adjudicator", () => {
  const style = toReviewStyle(undefined);
  const left = row("T4", { state: "left-open" });
  assert.equal(isClosed(left), true);
  assert.equal(rowTag(left, nameOf, { style, classes }).label, "left open");
});

test("only open and declined rows can be selected for an adjudicator", () => {
  assert.equal(canSend(row("a")), true);
  assert.equal(canSend(row("b", { state: "decided", decision: decision("agree") })), false);
  assert.equal(canSend(row("c", { state: "with-adjudicator" })), false);
  assert.equal(canSend(row("d", { state: "declined" })), true);
});

test("go to sign-off is primary only when every row is decided, left open or with the adjudicator", () => {
  const closed = [
    row("a", { state: "decided", decision: decision("agree") }),
    row("b", { state: "left-open" }),
    row("c", { state: "with-adjudicator", adjudicator: { user_id: "u3", note: null } }),
  ];
  assert.equal(allClosed(closed), true);
  assert.equal(allClosed([...closed, row("d")]), false);
  assert.equal(allClosed([...closed, row("e", { state: "declined" })]), false);
  assert.equal(allClosed([]), false);
});

test("declined and edited rows carry their own tags", () => {
  const style = toReviewStyle(undefined);
  const declined = row("T4", {
    state: "declined",
    adjudicator: { user_id: "u3", note: "Not my area" },
  });
  assert.deepEqual(rowTag(declined, nameOf, { style, classes }), {
    label: "declined by Anna Kopecka",
    tone: "warn",
  });
  const edited = row("T2", { edited: { by_user_id: "u1", on: "2026-11-03" } });
  assert.deepEqual(rowTag(edited, nameOf, { style, classes }), {
    label: "edited after decisions",
    tone: "warn",
  });
});
