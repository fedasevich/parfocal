import assert from "node:assert/strict";
import { test } from "node:test";
import { keyAction } from "../src/screens/settings/keymap.ts";
import {
  applySafeCombo,
  capture,
  currentKeys,
  freshShortcuts,
  safeCombo,
  startRecording,
  swap,
  take,
} from "../src/screens/settings/shortcuts.ts";

const letter = (key: string, extra: Record<string, boolean> = {}) => ({
  key,
  code: `Key${key.toUpperCase()}`,
  ...extra,
});

const recordingRuler = () => startRecording(freshShortcuts(), "truler", 0);

test("a key that already does something else offers to swap or take it", () => {
  const first = capture(recordingRuler(), letter("m"));
  const pending = first.state.pending;
  assert.equal(pending?.kind, "conflict");
  assert.equal(pending?.kind === "conflict" && pending.other, "tmarker");
  const swapped = swap(first.state);
  assert.deepEqual(currentKeys(swapped.state, keyAction("truler")), ["M"]);
  assert.deepEqual(currentKeys(swapped.state, keyAction("tmarker")), ["L"]);
  assert.equal(swapped.state.pending, null);
  const taken = take(first.state);
  assert.deepEqual(currentKeys(taken.state, keyAction("truler")), ["M"]);
  assert.deepEqual(currentKeys(taken.state, keyAction("tmarker")), []);
});

test("a key the browser keeps is refused and nothing changes", () => {
  const outcome = capture(recordingRuler(), letter("w", { metaKey: true }));
  assert.deepEqual(outcome.state.pending, { kind: "reserved", combo: "⌘W" });
  assert.deepEqual(outcome.state.custom, {});
});

test("a key that changes a report needs the command or control key", () => {
  const start = startRecording(freshShortcuts(), "signout", 0);
  const plain = capture(start, letter("s"));
  assert.deepEqual(plain.state.pending, { kind: "safe", combo: "S" });
  assert.deepEqual(plain.state.custom, {});
  assert.equal(safeCombo("⇧S"), "⌘S");
  const applied = applySafeCombo(plain.state);
  assert.deepEqual(currentKeys(applied, keyAction("signout")), ["⌘S"]);
  const direct = capture(start, letter("s", { metaKey: true }));
  assert.equal(direct.state.pending, null);
  assert.deepEqual(currentKeys(direct.state, keyAction("signout")), ["⌘S"]);
});
