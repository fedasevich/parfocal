import assert from "node:assert/strict";
import { test } from "node:test";
import { comboOf, idleKeys, type KeyInput, step } from "../src/keys/registry.ts";
import {
  applyViewerKey,
  type ViewerKeyTarget,
  viewerKeyBindings,
} from "../src/viewer/viewer-keys.ts";

type Key = Omit<Extract<KeyInput, { type: "down" | "up" }>, "at" | "type"> & {
  type?: "down" | "up";
};

const zoomOctaves = Math.log2(1.35);

function drive(keys: (Key | "blur")[], bindings = viewerKeyBindings()) {
  const calls: string[] = [];
  const target: ViewerKeyTarget = {
    zoomOctaves,
    zoomBy: (octaves) =>
      calls.push(
        `zoom ${octaves === zoomOctaves ? "in" : octaves === -zoomOctaves ? "out" : octaves}`,
      ),
    fit: () => calls.push("fit"),
    zoomToMagnification: (magnification) => calls.push(`mag ${magnification}`),
    press: (direction, fast) => calls.push(`press ${direction}${fast ? " fast" : ""}`),
    release: (direction) => calls.push(`release ${direction}`),
    back: () => calls.push("back"),
    forward: () => calls.push("forward"),
  };
  let state = idleKeys;
  const consumed: boolean[] = [];
  keys.forEach((key, index) => {
    const input: KeyInput =
      key === "blur" ? { type: "blur", at: index * 10 } : { type: "down", ...key, at: index * 10 };
    const result = step(bindings, state, input);
    state = result.state;
    consumed.push(result.consumed);
    const shift = key !== "blur" && Boolean(key.shiftKey);
    for (const fired of result.fired) applyViewerKey(fired, target, shift);
  });
  return { calls, consumed, state };
}

const arrow = (name: string, extra: Partial<Key> = {}): Key => ({
  key: `Arrow${name}`,
  code: `Arrow${name}`,
  ...extra,
});

test("each arrow starts a pan on key down and ends it on key up", () => {
  const { calls } = drive([
    arrow("Up"),
    arrow("Up", { type: "up" }),
    arrow("Down"),
    arrow("Down", { type: "up" }),
    arrow("Left"),
    arrow("Left", { type: "up" }),
    arrow("Right"),
    arrow("Right", { type: "up" }),
  ]);
  assert.deepEqual(calls, [
    "press up",
    "release up",
    "press down",
    "release down",
    "press left",
    "release left",
    "press right",
    "release right",
  ]);
});

test("key repeat does not restart a held pan and the key is still swallowed", () => {
  const { calls, consumed } = drive([
    arrow("Right"),
    arrow("Right", { repeat: true }),
    arrow("Right", { repeat: true }),
  ]);
  assert.deepEqual(calls, ["press right"]);
  assert.deepEqual(consumed, [true, true, true]);
});

test("Shift with an arrow pans fast", () => {
  const { calls } = drive([
    arrow("Left", { shiftKey: true }),
    arrow("Left", { type: "up", shiftKey: true }),
  ]);
  assert.deepEqual(calls, ["press left fast", "release left"]);
});

test("two arrows held together both pan and release on their own", () => {
  const { calls, state } = drive([
    arrow("Up"),
    arrow("Left"),
    arrow("Up", { type: "up" }),
    arrow("Left", { repeat: true }),
    arrow("Left", { type: "up" }),
  ]);
  assert.deepEqual(calls, ["press up", "press left", "release up", "release left"]);
  assert.equal(state.sustained.length, 0);
});

test("losing focus releases every held arrow", () => {
  const { calls } = drive([arrow("Up"), arrow("Right"), "blur"]);
  assert.deepEqual(calls, ["press up", "press right", "release up", "release right"]);
});

test("plus zooms in by 1.35 times from the plain key, the shifted key and the keypad", () => {
  const { calls } = drive([
    { key: "=", code: "Equal" },
    { key: "+", code: "Equal", shiftKey: true },
    { key: "+", code: "NumpadAdd" },
  ]);
  assert.deepEqual(calls, ["zoom in", "zoom in", "zoom in"]);
});

test("minus zooms out by 1.35 times and a held key keeps zooming", () => {
  const { calls } = drive([
    { key: "-", code: "Minus" },
    { key: "-", code: "Minus", repeat: true },
    { key: "-", code: "NumpadSubtract" },
  ]);
  assert.deepEqual(calls, ["zoom out", "zoom out", "zoom out"]);
});

test("0 fits the slide", () => {
  assert.deepEqual(drive([{ key: "0", code: "Digit0" }]).calls, ["fit"]);
  assert.deepEqual(drive([{ key: "0", code: "Numpad0" }]).calls, ["fit"]);
});

test("Alt+1 to Alt+6 jump to the six objective presets", () => {
  const keys = [1, 2, 3, 4, 5, 6].map((digit) => ({
    key: String(digit),
    code: `Digit${digit}`,
    altKey: true,
  }));
  assert.deepEqual(drive(keys).calls, [
    "mag 1.25",
    "mag 2.5",
    "mag 5",
    "mag 10",
    "mag 20",
    "mag 40",
  ]);
});

test("Alt+arrow is left to the brightness keys and does not pan", () => {
  const { calls, consumed } = drive([arrow("Up", { altKey: true })]);
  assert.deepEqual(calls, []);
  assert.deepEqual(consumed, [false]);
});

test("Alt+Left goes back a view and Alt+Right goes forward without panning", () => {
  const { calls, consumed } = drive([
    arrow("Left", { altKey: true }),
    arrow("Left", { altKey: true, type: "up" }),
    arrow("Right", { altKey: true }),
    arrow("Right", { altKey: true, type: "up" }),
  ]);
  assert.deepEqual(calls, ["back", "forward"]);
  assert.equal(consumed[0], true);
  assert.equal(consumed[2], true);
});

test("viewer keys do nothing while typing in a field", () => {
  const { calls } = drive([
    arrow("Left", { typing: true }),
    { key: "=", code: "Equal", typing: true },
    { key: "0", code: "Digit0", typing: true },
  ]);
  assert.deepEqual(calls, []);
});

test("the WASD preset pans with the same easing hold", () => {
  const { calls } = drive(
    [
      { key: "d", code: "KeyD" },
      { key: "d", code: "KeyD", type: "up" },
    ],
    viewerKeyBindings({ personal: { pan: ["WASD"] } }),
  );
  assert.deepEqual(calls, ["press right", "release right"]);
});

test("the shifted plus reads as plus", () => {
  assert.equal(comboOf({ type: "down", key: "+", code: "Equal", shiftKey: true, at: 0 }), "+");
  assert.equal(comboOf({ type: "down", key: "=", code: "Equal", at: 0 }), "+");
});
