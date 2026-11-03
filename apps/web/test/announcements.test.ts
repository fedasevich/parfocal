import assert from "node:assert/strict";
import { test } from "node:test";
import { endsAtFor, textProblem, untilLabel } from "../src/screens/home/announcement-rules.ts";

const at = new Date(2026, 9, 15, 14, 30);

test("an announcement can stay until ended or last an hour, a day or a week", () => {
  assert.equal(endsAtFor("ended", at), null);
  assert.equal(endsAtFor("hour", at), new Date(2026, 9, 15, 15, 30).toISOString());
  assert.equal(endsAtFor("day", at), new Date(2026, 9, 16, 14, 30).toISOString());
  assert.equal(endsAtFor("week", at), new Date(2026, 9, 22, 14, 30).toISOString());
});

test("the end of an announcement reads as a time today and a day and time later", () => {
  assert.equal(untilLabel(null, at), null);
  assert.equal(untilLabel(new Date(2026, 9, 15, 15, 30).toISOString(), at), "until 15:30");
  assert.equal(untilLabel(new Date(2026, 9, 22, 14, 30).toISOString(), at), "until 22 Oct, 14:30");
});

test("the text must be filled and at most 280 characters once trimmed", () => {
  assert.equal(textProblem("   "), "Write what you want to tell people.");
  assert.equal(textProblem("Server is slow"), undefined);
  assert.equal(textProblem(`  ${"a".repeat(280)}  `), undefined);
  assert.equal(textProblem("a".repeat(281)), "Keep it to 280 characters.");
});
