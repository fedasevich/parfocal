import assert from "node:assert/strict";
import { test } from "node:test";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { keyLabel } from "../src/keys/key-labels.ts";
import { idleKeys, keyInputOf, step } from "../src/keys/registry.ts";
import { keyAction, keyActions } from "../src/screens/settings/keymap.ts";
import { exportShortcuts, importShortcuts } from "../src/screens/settings/shortcut-file.ts";
import {
  capture,
  clashesWith,
  currentKeys,
  freshShortcuts,
  shortcutSettingsOf,
  startRecording,
} from "../src/screens/settings/shortcuts.ts";
import { peekKeyStep } from "../src/screens/viewer-tools/peek-model.ts";

const event = (key: string, code: string, extra: Partial<KeyboardEvent> = {}) => ({
  key,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  timeStamp: 0,
  ...extra,
});

const fired = (
  bindings: ReturnType<typeof keyRegistry.bindings>,
  press: ReturnType<typeof event>,
  byPosition: boolean,
) =>
  step(bindings, idleKeys, keyInputOf("down", press, false, byPosition)).fired.map((f) => f.action);

test("the magnification keys keep their place on a Czech keyboard", () => {
  const bindings = keyRegistry.bindings({ scopes: ["viewer"] });
  const press = event("ě", "Digit2", { altKey: true });
  assert.deepEqual(fired(bindings, press, true), ["mag:2"]);
  assert.deepEqual(fired(bindings, press, false), []);
});

test("switching single-letter shortcuts off keeps the keys with a modifier", () => {
  const all = keyRegistry.bindings({ scopes: ["viewer", "review", "annotate"] });
  const off = keyRegistry.bindings({
    scopes: ["viewer", "review", "annotate"],
    singleLetter: false,
  });
  assert.ok(all.some((binding) => binding.keys[0] === "K"));
  assert.ok(!off.some((binding) => binding.keys[0] === "K"));
  assert.ok(off.some((binding) => binding.keys[0] === "⌥1"));
  assert.ok(off.some((binding) => binding.keys[0] === "⌘K"));
  assert.equal(keyLabel(keyRegistry.defs, { singleLetter: false }, "dagree"), null);
  assert.equal(keyLabel(keyRegistry.defs, { singleLetter: true }, "dagree"), "K");
});

test("a rebound J shows as the label and fires on the new key only", () => {
  const resolve = { personal: { dnext: ["W"] } };
  assert.equal(keyLabel(keyRegistry.defs, resolve, "dnext"), "W");
  const bindings = keyRegistry.bindings({ ...resolve, scopes: ["review"], only: ["dnext"] });
  assert.deepEqual(fired(bindings, event("w", "KeyW"), true), ["dnext"]);
  assert.deepEqual(fired(bindings, event("j", "KeyJ"), true), []);
});

test("every action but undo and Esc takes a new key and fires on it", () => {
  const press = event("F9", "F9", { metaKey: true, altKey: true, shiftKey: true });
  const settable = keyActions.filter(
    (action) => !(action.fixed || action.range || action.direction || action.sequence),
  );
  assert.deepEqual(
    keyActions.filter((action) => action.fixed).map((action) => action.id),
    ["undo", "esc"],
  );
  for (const action of settable) {
    const next = capture(startRecording(freshShortcuts(), action.id, 0), press);
    assert.equal(next.state.pending, null, action.id);
    const custom = next.state.custom;
    const bindings = keyRegistry.bindings({
      personal: custom,
      scopes: [action.scope],
      only: [action.id],
    });
    assert.deepEqual(fired(bindings, press, true), [action.id], action.id);
  }
});

test("a range keeps its own digits when the modifier changes", () => {
  const next = capture(startRecording(freshShortcuts(), "dcert", 0), {
    key: "Alt",
    altKey: true,
  });
  assert.deepEqual(currentKeys(next.state, keyAction("dcert")), ["⌥1 … ⌥5"]);
});

test("a chord's first key clashes with a plain key of the same place", () => {
  const state = freshShortcuts();
  const clash = capture(startRecording(state, "area", 0), { key: "p", code: "KeyP" });
  assert.equal(clash.state.pending?.kind, "setclash");
  assert.ok(clashesWith(state, keyAction("tfree"), "⇧P").length === 0);
});

test("whole-slide modes: tap toggles and hold shows while held", () => {
  const holdStart = { action: "peek", phase: "hold-start" } as const;
  const tap = { action: "peek", phase: "tap" } as const;
  assert.equal(peekKeyStep(false, false, holdStart, "tap").effect, null);
  assert.equal(peekKeyStep(false, false, tap, "tap").effect, "latch");
  assert.equal(peekKeyStep(true, false, tap, "tap").effect, "close");
  assert.equal(peekKeyStep(false, false, holdStart, "hold").effect, "hold");
  assert.equal(peekKeyStep(true, false, tap, "hold").effect, "close");
});

test("the keys file round-trips and refuses what it should", () => {
  const state = { ...freshShortcuts(), custom: { dnext: ["W"], truler: ["D"] } };
  const text = exportShortcuts(shortcutSettingsOf(state));
  const current = shortcutSettingsOf(freshShortcuts());
  const back = importShortcuts(text, current);
  assert.ok(back.ok);
  if (back.ok) assert.deepEqual(back.settings.custom, state.custom);
  const bad = importShortcuts(
    JSON.stringify({
      kind: "parfocal-shortcuts",
      version: 1,
      custom: { nothing: ["A"], undo: ["B"], tcomment: ["⌘W"], signout: ["S"] },
    }),
    current,
  );
  assert.ok(bad.ok);
  if (bad.ok) {
    assert.deepEqual(bad.settings.custom, {});
    assert.equal(bad.dropped.length, 4);
  }
  assert.equal(importShortcuts("{", current).ok, false);
});
