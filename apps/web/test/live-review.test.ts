import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReviewSession } from "../src/screens/review/review-data.ts";
import { liveReview, submitReason } from "../src/viewer/live-review.ts";

test("Submit has no reason to wait when nothing is open", () => {
  assert.equal(submitReason([], []), undefined);
});

test("one open object or question is named", () => {
  assert.equal(submitReason(["T3"], []), "T3 is still open.");
  assert.equal(submitReason([], [2]), "Question 2 is not answered.");
});

test("several open objects and questions are counted like the mock", () => {
  const objects = ["T1", "T2", "T3", "T4", "T5", "C1", "C2"];
  assert.equal(submitReason(objects, [1, 3]), "7 objects and 2 questions are still open.");
  assert.equal(submitReason(objects, []), "7 objects are still open.");
  assert.equal(submitReason(["T1"], [1]), "1 object and 1 question are still open.");
  assert.equal(submitReason([], [1, 2]), "2 questions are still open.");
});

const session = (over: Partial<ReviewSession>): ReviewSession =>
  ({
    ready: true,
    slideName: "A1 · H&E",
    objects: [{ object: "T1" }, { object: "T2" }, { object: "T3" }],
    added: [{ object: "T6⁺", note: null }],
    decisions: new Map([
      ["T1", { value: "agree" }],
      ["T2", { value: "unsure" }],
    ]),
    task: undefined,
    opinion: {
      questions: [
        { key: "quality", label: "Quality", kind: "scale", required: true },
        { key: "note", label: "Note", kind: "text", required: false },
      ],
      answers: { quality: null },
    },
    ...over,
  }) as unknown as ReviewSession;

test("the top bar counts the same objects as the Opinion tab and keeps added ones apart", () => {
  const review = liveReview(session({}));
  assert.deepEqual(review?.split, {
    agree: 1,
    disagree: 0,
    unsure: 1,
    open: 1,
    decided: 2,
    total: 3,
  });
  assert.deepEqual(review?.added, ["T6⁺"]);
  assert.equal(review?.slideName, "A1 · H&E");
  assert.equal(review?.submitReason, "1 object and 1 question are still open.");
});

test("Submit opens once every object is decided and every required question answered", () => {
  const decisions = new Map(["T1", "T2", "T3"].map((object) => [object, { value: "agree" }]));
  const opinion = { questions: session({}).opinion?.questions ?? [], answers: { quality: 4 } };
  const review = liveReview(session({ decisions, opinion } as unknown as Partial<ReviewSession>));
  assert.equal(review?.submitReason, undefined);
  assert.equal(review?.split.open, 0);
});

test("nothing is counted before the slide's objects have loaded", () => {
  assert.equal(liveReview(session({ ready: false })), undefined);
});
