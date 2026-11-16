import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createPenDoubleTap,
  createToolHistory,
  fingerPans,
  fingerSelectStep,
  isPenErase,
  stageAction,
} from "../src/devices/pen-touch.ts";

const input = (pointerType: string, button = 0, buttons = 1) => ({ pointerType, button, buttons });

test("a finger pans and never draws", () => {
  assert.equal(stageAction(input("touch")), "pan");
  assert.equal(stageAction(input("touch", 0, 0)), "pan");
  assert.equal(stageAction(input("touch", 2, 2)), "pan");
  assert.equal(fingerPans({ pointerType: "touch" }), true);
  assert.equal(fingerPans({ pointerType: "pen" }), false);
});

test("a finger can tap to select but never drags a shape", () => {
  assert.equal(fingerSelectStep("touch", "pointerdown"), "tap-only");
  assert.equal(fingerSelectStep("touch", "pointerup"), "tap-only");
  assert.equal(fingerSelectStep("touch", "pointermove"), "ignore");
  assert.equal(fingerSelectStep("pen", "pointermove"), "full");
  assert.equal(fingerSelectStep("mouse", "pointerdown"), "full");
});

test("a pen draws with the active tool", () => {
  assert.equal(stageAction(input("pen")), "draw");
  assert.equal(stageAction(input("pen", 0, 0)), "draw");
});

test("the barrel button and the eraser end erase", () => {
  assert.equal(stageAction(input("pen", 0, 3)), "erase");
  assert.equal(stageAction(input("pen", 2, 2)), "erase");
  assert.equal(stageAction(input("pen", 0, 33)), "erase");
  assert.equal(stageAction(input("pen", 5, 32)), "erase");
  assert.equal(isPenErase(input("mouse", 2, 2)), false);
});

test("a mouse draws with the primary button only", () => {
  assert.equal(stageAction(input("mouse")), "draw");
  assert.equal(stageAction(input("mouse", 2, 2)), "ignore");
  assert.equal(stageAction(input("mouse", 1, 4)), "ignore");
});

test("two pen taps close together and in time are a double tap", () => {
  const detector = createPenDoubleTap();
  assert.equal(detector.tap({ at: 0, x: 10, y: 10 }), false);
  assert.equal(detector.tap({ at: 200, x: 14, y: 12 }), true);
  assert.equal(detector.tap({ at: 300, x: 14, y: 12 }), false);
});

test("slow or distant pen taps are not a double tap", () => {
  const detector = createPenDoubleTap();
  detector.tap({ at: 0, x: 0, y: 0 });
  assert.equal(detector.tap({ at: 400, x: 0, y: 0 }), false);
  assert.equal(detector.tap({ at: 500, x: 200, y: 0 }), false);
  detector.reset();
  assert.equal(detector.tap({ at: 520, x: 200, y: 0 }), false);
});

test("the tool history swaps to the last tool and back", () => {
  const tools = createToolHistory("select");
  assert.equal(tools.swap(), "select");
  tools.select("free");
  assert.equal(tools.previous(), "select");
  assert.equal(tools.swap(), "select");
  assert.equal(tools.current(), "select");
  assert.equal(tools.swap(), "free");
  tools.select("free");
  assert.equal(tools.previous(), "select");
});
