import assert from "node:assert/strict";
import { test } from "node:test";
import { dispatchIntentKey, keyForIntent, steppedPreset } from "../src/devices/intent-keys.ts";
import { type Intent, mapInput } from "../src/devices/intents.ts";

const keyboardIntent = (intent: Intent) => {
  const spec = keyForIntent(intent);
  if (spec === null) return [];
  return mapInput("keyboard", "review", {
    kind: "key",
    key: spec.key,
    shift: spec.shiftKey,
  });
};

test("each button intent maps back to the keyboard shortcut for the same intent", () => {
  const intents: Intent[] = [
    { kind: "keep" },
    { kind: "notACell" },
    { kind: "nextCell" },
    { kind: "previousCell" },
    { kind: "setType", type: 1 },
    { kind: "setType", type: 4 },
  ];
  for (const intent of intents) assert.deepEqual(keyboardIntent(intent), [intent]);
  const area = (intent: Intent) => {
    const spec = keyForIntent(intent);
    return spec === null ? [] : mapInput("keyboard", "read", { kind: "key", key: spec.key });
  };
  assert.deepEqual(area({ kind: "nextArea" }), [{ kind: "nextArea" }]);
  assert.deepEqual(area({ kind: "previousArea" }), [{ kind: "previousArea" }]);
});

test("camera and peek intents have no key", () => {
  assert.equal(keyForIntent({ kind: "peek", held: true }), null);
  assert.equal(keyForIntent({ kind: "presetStep", step: 1 }), null);
  assert.equal(keyForIntent({ kind: "pan", dx: 1, dy: 0, unit: "rate" }), null);
});

test("dispatching sends a keydown then a keyup", () => {
  const seen: string[] = [];
  const target = {
    dispatchEvent: (event: Event) => {
      seen.push(event.type);
      return true;
    },
  };
  const make = (type: "keydown" | "keyup", init: { key: string }) =>
    Object.assign(new Event(type), { key: init.key });
  assert.equal(dispatchIntentKey({ kind: "keep" }, target, make), true);
  assert.deepEqual(seen, ["keydown", "keyup"]);
  assert.equal(dispatchIntentKey({ kind: "peek", held: true }, target, make), false);
  assert.equal(seen.length, 2);
});

test("preset steps move one detent and stop at the ends", () => {
  assert.equal(steppedPreset(10, 1), 20);
  assert.equal(steppedPreset(10, -1), 5);
  assert.equal(steppedPreset(40, 1), 40);
  assert.equal(steppedPreset(1.25, -1), 1.25);
  assert.equal(steppedPreset(11, 1), 20);
});
