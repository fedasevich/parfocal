import assert from "node:assert/strict";
import { test } from "node:test";
import { EngineNotReadyError } from "@parfocal/viewer-engine";
import { modelNotStartedText, plainFailure } from "../src/aiseg/plain-message.ts";
import { toolHintList } from "../src/help/tool-hint-list.ts";
import { toolHints } from "../src/screens/viewer-tools/rails.ts";

test("Help lists every tool that has a hint once, with its seen id", () => {
  const list = toolHintList();
  assert.deepEqual(new Set(list.map((entry) => entry.tool)), new Set(Object.keys(toolHints)));
  assert.equal(new Set(list.map((entry) => entry.id)).size, list.length);
  const rect = list.find((entry) => entry.tool === "rect");
  assert.equal(rect?.id, "viewer.tool.rect");
  assert.equal(rect?.label, "Rectangle");
});

test("the Smart select hint no longer repeats the hover preview state", () => {
  assert.equal(
    toolHints["smart"]?.some((line) => line.toLowerCase().includes("hover")),
    false,
  );
});

test("a raw engine message becomes plain words and other errors give the fallback", () => {
  assert.equal(plainFailure(new EngineNotReadyError(), "fallback"), modelNotStartedText);
  assert.equal(plainFailure(new Error("The inference worker blew up"), "fallback"), "fallback");
  assert.equal(modelNotStartedText.includes("inference engine"), false);
});
