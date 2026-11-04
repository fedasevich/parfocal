import assert from "node:assert/strict";
import { test } from "node:test";
import { dotGlyphOf, dotStateWord, nextOpenIndex } from "../src/screens/review/guided-progress.ts";

const order = ["T5", "T4", "T3", "T2", "T1"];
const answeredIn = (done: string[]) => (object: string) => done.includes(object);

test("answering moves on to the next open object", () => {
  assert.equal(nextOpenIndex(order, 0, answeredIn(["T5"])), 1);
  assert.equal(nextOpenIndex(order, 2, answeredIn(["T5", "T3"])), 3);
});

test("answered objects after the current one are skipped over", () => {
  assert.equal(nextOpenIndex(order, 0, answeredIn(["T5", "T4", "T3"])), 3);
});

test("the camera comes back to the first open object when none is left ahead", () => {
  assert.equal(nextOpenIndex(order, 4, answeredIn(["T5", "T1", "T2", "T3"])), 1);
  assert.equal(nextOpenIndex(order, 3, answeredIn(["T2", "T3", "T4", "T1"])), 0);
});

test("the slide is done when every object is answered", () => {
  assert.equal(nextOpenIndex(order, 4, answeredIn(order)), null);
  assert.equal(nextOpenIndex([], 0, answeredIn([])), null);
});

test("the dots carry a different glyph for each state", () => {
  assert.equal(dotGlyphOf("agree"), "check");
  assert.equal(dotGlyphOf("disagree"), "cross");
  assert.equal(dotGlyphOf("unsure"), "question");
  assert.equal(dotGlyphOf(undefined), null);
  const glyphs = new Set(["agree", "disagree", "unsure"].map((v) => dotGlyphOf(v as never)));
  assert.equal(glyphs.size, 3);
});

test("a dot says its state in words as well", () => {
  assert.equal(dotStateWord("agree", false), "agree");
  assert.equal(dotStateWord("disagree", false), "disagree");
  assert.equal(dotStateWord("unsure", false), "not sure");
  assert.equal(dotStateWord(undefined, true), "skipped, still open");
  assert.equal(dotStateWord(undefined, false), "not answered yet");
});
