import assert from "node:assert/strict";
import { test } from "node:test";
import { actionHintText, toolHintText } from "../src/viewer/tool-hint-text.ts";

test("a tool's hint lines join into sentences", () => {
  assert.equal(toolHintText("rect"), "Drag corner to corner. ⇧ makes a square");
});

test("a shortcut action finds its tool's hint through the rails", () => {
  assert.equal(actionHintText("tpoly"), toolHintText("poly"));
  assert.equal(actionHintText("tcomment"), toolHintText("comment"));
});

test("actions and tools without a hint give nothing", () => {
  assert.equal(actionHintText("undo"), undefined);
  assert.equal(toolHintText("nothing"), undefined);
});
