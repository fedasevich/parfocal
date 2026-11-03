import assert from "node:assert/strict";
import { test } from "node:test";
import type { ActionDef } from "../src/keys/actions.ts";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { keyLabel, keyLabeller } from "../src/keys/key-labels.ts";
import { conflicts } from "../src/keys/registry.ts";
import { decisionKeyActions } from "../src/screens/review/decision-mapping.ts";
import { noteAction } from "../src/screens/review/note-key.ts";
import { annotateRail, reviewRail } from "../src/screens/viewer-tools/rails.ts";

const defs = keyRegistry.defs;

test("a keycap shows the default binding without settings", () => {
  const label = keyLabeller(defs, undefined);
  assert.equal(label("dagree"), "K");
  assert.equal(label("hideui"), "⌘\\");
  assert.equal(label("linkviews"), "⇧L");
});

test("a keycap follows the chosen preset", () => {
  const ruler: ActionDef = {
    id: "truler",
    scope: "annotate",
    keys: ["L"],
    presets: { qupath: ["M"] },
  };
  assert.equal(keyLabel([ruler], { preset: "qupath" }, "truler"), "M");
  assert.equal(keyLabel([ruler], { preset: "figma" }, "truler"), "L");
  assert.equal(
    keyLabel([ruler], { preset: "qupath", personal: { truler: ["⇧M"] } }, "truler"),
    "⇧M",
  );
});

test("a keycap follows the person's own binding over the preset", () => {
  const label = keyLabeller(defs, { preset: "figma", custom: { dagree: ["A"], peek: ["⇧Z"] } });
  assert.equal(label("dagree"), "A");
  assert.equal(label("peek"), "⇧Z");
  assert.equal(label("ddisagree"), "X");
});

test("an unbound action shows no keycap", () => {
  const label = keyLabeller(defs, { preset: "default", custom: { dagree: [] } });
  assert.equal(label("dagree"), null);
  assert.equal(label("dadd"), null);
});

test("an unknown action falls back to the written key", () => {
  assert.equal(keyLabeller(defs, undefined)("nothing"), undefined);
});

test("one step of a range or direction shows its own key", () => {
  const label = keyLabeller(defs, { preset: "default", custom: { mag: ["⌃1 … ⌃6"] } });
  assert.equal(label("dcert:3"), "3");
  assert.equal(label("preset:2"), "⇧2");
  assert.equal(label("mag:4"), "⌃4");
  assert.equal(label("mag"), "⌃1 … ⌃6");
  assert.equal(label("pan:left"), "←");
  assert.equal(label("area:2"), "G 2");
  assert.equal(label("dclass:9"), null);
});

test("rail badges and the note hint follow a changed binding", () => {
  const rails = [...reviewRail.flat(), ...annotateRail.flat()];
  const ids = new Set(defs.map((def) => def.id));
  for (const item of rails) assert.ok(item.action && ids.has(item.action), item.tool);
  const before = keyLabeller(defs, undefined);
  assert.equal(before("tselect"), "V");
  assert.equal(before(noteAction), "⇧N");
  const after = keyLabeller(defs, {
    preset: "default",
    custom: { tselect: ["⇧V"], tbrush: ["⌘B"], [noteAction]: ["⇧M"] },
  });
  const badge = (tool: string) => {
    const item = rails.find((rail) => rail.tool === tool);
    return item?.action === undefined ? undefined : after(item.action);
  };
  assert.equal(badge("select"), "⇧V");
  assert.equal(badge("brush"), "⌘B");
  assert.equal(badge("rect"), "R");
  assert.equal(after(noteAction), "⇧M");
});

test("no two actions in one decision style share a key", () => {
  for (const kind of ["agree", "yesno", "certainty", "blind"] as const) {
    const bindings = keyRegistry.bindings({ scopes: ["review"], only: decisionKeyActions(kind) });
    assert.deepEqual(conflicts(bindings), [], kind);
    assert.ok(
      bindings.some((binding) => binding.action === noteAction),
      kind,
    );
  }
});
