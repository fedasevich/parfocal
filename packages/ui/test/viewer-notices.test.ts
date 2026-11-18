import assert from "node:assert/strict";
import { test } from "node:test";
import { type NoticeFacts, offlineAfterAttempts, planNotices } from "../src/lib/viewer-notices.ts";

const calm: NoticeFacts = { phase: "idle", attempt: 0, conflicts: 0, lost: false, incoming: 0 };

test("a calm slide shows no notice and no word, and saving and saved are only quiet words", () => {
  assert.deepEqual(planNotices(calm), { shown: null, waiting: [], word: null, urgency: null });
  assert.deepEqual(planNotices({ ...calm, phase: "saving" }), {
    shown: null,
    waiting: [],
    word: "saving",
    urgency: null,
  });
  assert.equal(planNotices({ ...calm, phase: "saved" }).word, "saved");
  assert.equal(planNotices({ ...calm, phase: "saved" }).shown, null);
});

test("a short network blip stays a quiet word and a long one becomes the banner", () => {
  const blip = planNotices({ ...calm, phase: "retrying", attempt: offlineAfterAttempts - 1 });
  assert.equal(blip.shown, null);
  assert.equal(blip.word, "waiting");
  const long = planNotices({ ...calm, phase: "retrying", attempt: offlineAfterAttempts });
  assert.equal(long.shown, "offline");
  assert.equal(long.word, "waiting");
  assert.equal(long.urgency, "assertive");
});

test("a colleague's changes alone are shown and announced politely", () => {
  const plan = planNotices({ ...calm, phase: "saved", incoming: 2 });
  assert.equal(plan.shown, "changes");
  assert.equal(plan.urgency, "polite");
  assert.equal(plan.word, "saved");
});

test("a conflict is shown before a colleague's changes, which wait in the line below", () => {
  const plan = planNotices({ ...calm, phase: "conflict", conflicts: 1, incoming: 1 });
  assert.equal(plan.shown, "conflict");
  assert.deepEqual(plan.waiting, ["changes"]);
  assert.equal(plan.urgency, "assertive");
  assert.equal(plan.word, null);
});

test("edits not saved stay after the next save succeeds, until the reader dismisses them", () => {
  const latched = planNotices({ ...calm, phase: "saved", lost: true });
  assert.equal(latched.shown, "not-saved");
  assert.equal(latched.word, "not-saved");
  assert.equal(planNotices({ ...calm, phase: "saved", lost: false }).shown, null);
});

test("a refused save does not hide an open conflict, and the conflict is not called saved", () => {
  const plan = planNotices({ ...calm, phase: "failed", conflicts: 2, lost: true, incoming: 1 });
  assert.equal(plan.shown, "conflict");
  assert.deepEqual(plan.waiting, ["not-saved", "changes"]);
  assert.equal(plan.word, "not-saved");
  assert.equal(planNotices({ ...calm, phase: "saved", conflicts: 1 }).word, null);
});

test("a conflict open while the connection is down shows the conflict and keeps offline waiting", () => {
  const plan = planNotices({ ...calm, phase: "retrying", attempt: 5, conflicts: 1 });
  assert.equal(plan.shown, "conflict");
  assert.deepEqual(plan.waiting, ["offline"]);
  assert.equal(plan.word, "waiting");
});
