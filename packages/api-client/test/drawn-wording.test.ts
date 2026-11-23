import assert from "node:assert/strict";
import { test } from "node:test";
import { drawnText, textFor } from "../src/drawn-wording.ts";

test("AI wording in a form label reads as drawn outlines", () => {
  assert.equal(
    drawnText("Is the AI result acceptable for this slide?"),
    "Are the drawn outlines acceptable for this slide?",
  );
  assert.equal(
    drawnText("Does the AI miss any tumor on this slide?"),
    "Do the drawn outlines miss any tumor on this slide?",
  );
  assert.equal(drawnText("Did the AI miss a region?"), "Did the drawn outlines miss a region?");
  assert.equal(drawnText("Comment"), "Comment");
});

test("an AI task keeps the label as written", () => {
  assert.equal(textFor("Is the AI result good?", false), "Is the AI result good?");
  assert.equal(textFor("Is the AI result good?", true), "Are the drawn outlines good?");
});
