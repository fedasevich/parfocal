import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createDocument } from "../src/annotations/document.ts";
import { createHistory, record, redo, undo } from "../src/annotations/history.ts";
import {
  addArrow,
  addText,
  arrowEndsOf,
  arrowHead,
  arrowsOf,
  cleanText,
  maxTextLength,
  textPointOf,
  textsOf,
} from "../src/annotations/marks.ts";

describe("arrow and text marks", () => {
  test("an arrow keeps its tail and its tip in order", () => {
    const doc = addArrow(createDocument(), { from: { x: 10, y: 20 }, to: { x: 90, y: 60 } });
    const [shape] = arrowsOf(doc);
    assert.ok(shape);
    assert.equal(shape.kind, "arrow");
    assert.deepEqual(arrowEndsOf(shape), { from: { x: 10, y: 20 }, to: { x: 90, y: 60 } });
  });

  test("the head wings sit behind the tip and mirror each other", () => {
    const [left, right] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    assert.ok(left.x < 100 && right.x < 100);
    assert.ok(Math.abs(left.x - right.x) < 1e-9);
    assert.ok(Math.abs(left.y + right.y) < 1e-9);
    assert.ok(Math.abs(left.y) > 0);
  });

  test("text is trimmed, kept at its point and carries the words", () => {
    const doc = addText(createDocument(), { point: { x: 5, y: 7 }, text: "  mitosis here  " });
    const [shape] = textsOf(doc);
    assert.ok(shape);
    assert.equal(shape.text, "mitosis here");
    assert.deepEqual(textPointOf(shape), { x: 5, y: 7 });
  });

  test("empty or blank text adds nothing", () => {
    const doc = createDocument();
    assert.equal(addText(doc, { point: { x: 1, y: 1 }, text: "   " }), doc);
    assert.equal(textsOf(addText(doc, { point: { x: 1, y: 1 }, text: "" })).length, 0);
  });

  test("text is cut at the limit", () => {
    assert.equal(cleanText("a".repeat(maxTextLength + 40)).length, maxTextLength);
  });

  test("undo takes a committed text away and redo restores it", () => {
    const before = createDocument();
    const after = addText(before, { point: { x: 3, y: 4 }, text: "keep" });
    const recorded = record(createHistory(), before, after, "Add text");
    const undone = undo(recorded.history);
    assert.ok(undone);
    assert.equal(textsOf(undone.document).length, 0);
    const redone = redo(undone.history);
    assert.ok(redone);
    assert.equal(textsOf(redone.document)[0]?.text, "keep");
  });
});
