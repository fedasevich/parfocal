import assert from "node:assert/strict";
import { test } from "node:test";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { personalBindings } from "../src/keys/personal-keys.ts";
import { idleKeys, step } from "../src/keys/registry.ts";
import { keyActions } from "../src/screens/settings/keymap.ts";
import { freshShortcuts, visibleActions } from "../src/screens/settings/shortcuts.ts";

test("the question mark key fires the shortcut sheet action", () => {
  const bindings = personalBindings({}, [], ["sheet"]);
  const fired = step(bindings, idleKeys, {
    type: "down",
    key: "?",
    code: "Slash",
    shiftKey: true,
    at: 0,
  }).fired;
  assert.deepEqual(
    fired.map((entry) => entry.action),
    ["sheet"],
  );
});

test("every registered action appears in the Shortcuts section with a source", () => {
  const listed = new Set(visibleActions(freshShortcuts(), "").map((action) => action.id));
  for (const def of keyRegistry.defs) assert.ok(listed.has(def.id), `${def.id} is not listed`);
  for (const action of keyActions) {
    assert.ok(listed.has(action.id), `${action.id} is not listed`);
    assert.ok(["clin", "fig", "qp", "new"].includes(action.source), `${action.id} has no source`);
  }
});
