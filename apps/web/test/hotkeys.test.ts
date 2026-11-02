import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type Binding,
  conflicts,
  type Fired,
  idleKeys,
  type KeyInput,
  type KeyState,
  parseKeys,
  resolveBindings,
  step,
} from "../src/keys/registry.ts";

const bindings: Binding[] = [
  { action: "area2", keys: parseKeys("G then 2") },
  { action: "goNext", keys: parseKeys("G then N") },
  { action: "certain", keys: ["2"] },
  { action: "peek", keys: ["Z"], hold: true },
  { action: "palette", keys: ["⌘K"], inInputs: true },
];

type KeyEvent = Extract<KeyInput, { type: "down" | "up" }>;

type Press = Omit<KeyEvent, "type" | "key"> & { type?: KeyInput["type"]; key?: string };

function run(list: readonly Binding[], presses: Press[]): { fired: Fired[]; state: KeyState } {
  let state = idleKeys;
  const fired: Fired[] = [];
  for (const { type = "down", key = "", ...rest } of presses) {
    const input: KeyInput = type === "blur" ? { type, at: rest.at } : { type, key, ...rest };
    const result = step(list, state, input);
    state = result.state;
    fired.push(...result.fired);
  }
  return { fired, state };
}

test("G then 2 fires the chord and not the bare 2", () => {
  const { fired, state } = run(bindings, [
    { key: "g", at: 0 },
    { key: "2", code: "Digit2", at: 200 },
  ]);
  assert.deepEqual(fired, [{ action: "area2", phase: "press" }]);
  assert.equal(state.pending, null);
});

test("a bare 2 fires its own action", () => {
  const { fired } = run(bindings, [{ key: "2", code: "Digit2", at: 0 }]);
  assert.deepEqual(fired, [{ action: "certain", phase: "press" }]);
});

test("a chord expires after a second, and the late key acts alone", () => {
  const { fired } = run(bindings, [
    { key: "g", at: 0 },
    { key: "2", code: "Digit2", at: 1500 },
  ]);
  assert.deepEqual(fired, [{ action: "certain", phase: "press" }]);
});

test("Escape cancels a waiting chord", () => {
  const { fired, state } = run(bindings, [
    { key: "g", at: 0 },
    { key: "Escape", at: 100 },
    { key: "2", code: "Digit2", at: 200 },
  ]);
  assert.deepEqual(fired, [{ action: "certain", phase: "press" }]);
  assert.equal(state.pending, null);
});

test("a chord is not started or finished while typing in a text field", () => {
  const { fired, state } = run(bindings, [
    { key: "g", at: 0, typing: true },
    { key: "2", code: "Digit2", at: 100, typing: true },
  ]);
  assert.deepEqual(fired, []);
  assert.equal(state.pending, null);
});

test("⌘K still fires while typing because it is allowed in inputs", () => {
  const { fired } = run(bindings, [{ key: "k", code: "KeyK", metaKey: true, at: 0, typing: true }]);
  assert.deepEqual(fired, [{ action: "palette", phase: "press" }]);
});

test("Ctrl stands for ⌘ so Windows and Linux get the same binding", () => {
  const { fired } = run(bindings, [{ key: "k", code: "KeyK", ctrlKey: true, at: 0 }]);
  assert.deepEqual(fired, [{ action: "palette", phase: "press" }]);
});

test("a short Z is a tap and a long Z is a hold", () => {
  const tap = run(bindings, [
    { key: "z", code: "KeyZ", at: 0 },
    { type: "up", key: "z", code: "KeyZ", at: 120 },
  ]);
  assert.deepEqual(tap.fired, [
    { action: "peek", phase: "hold-start" },
    { action: "peek", phase: "tap" },
  ]);
  const hold = run(bindings, [
    { key: "z", code: "KeyZ", at: 0 },
    { key: "z", code: "KeyZ", at: 30, repeat: true },
    { key: "z", code: "KeyZ", at: 60, repeat: true },
    { type: "up", key: "z", code: "KeyZ", at: 600 },
  ]);
  assert.deepEqual(hold.fired, [
    { action: "peek", phase: "hold-start" },
    { action: "peek", phase: "hold-end" },
  ]);
});

test("Z typed into a field neither holds nor taps", () => {
  const { fired } = run(bindings, [
    { key: "z", code: "KeyZ", at: 0, typing: true },
    { type: "up", key: "z", code: "KeyZ", at: 600, typing: true },
  ]);
  assert.deepEqual(fired, []);
});

test("losing window focus ends a hold", () => {
  const { fired, state } = run(bindings, [
    { key: "z", code: "KeyZ", at: 0 },
    { type: "blur", at: 900 },
  ]);
  assert.deepEqual(fired, [
    { action: "peek", phase: "hold-start" },
    { action: "peek", phase: "hold-end" },
  ]);
  assert.deepEqual(state, idleKeys);
});

test("a preset and then a personal binding override the default in order", () => {
  const resolved = resolveBindings(bindings, { peek: ["W"], area2: ["⇧2"] }, { peek: ["Y"] });
  assert.deepEqual(resolved.find((binding) => binding.action === "peek")?.keys, ["Y"]);
  const { fired } = run(resolved, [{ key: "@", code: "Digit2", shiftKey: true, at: 0 }]);
  assert.deepEqual(fired, [{ action: "area2", phase: "press" }]);
});

test("a single key that is also the start of a chord is reported as a conflict", () => {
  const clash = [...bindings, { action: "goSomewhere", keys: ["G"] }];
  assert.deepEqual(conflicts(clash), [
    ["area2", "goSomewhere"],
    ["goNext", "goSomewhere"],
  ]);
  assert.deepEqual(conflicts(bindings), []);
});
