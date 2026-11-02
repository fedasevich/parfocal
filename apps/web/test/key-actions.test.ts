import assert from "node:assert/strict";
import { test } from "node:test";
import { type ActionDef, actionOf, createActionRegistry, expandSlot } from "../src/keys/actions.ts";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { type Binding, type Fired, idleKeys, type KeyInput, step } from "../src/keys/registry.ts";

type Press = {
  type?: "down" | "up";
  key: string;
  code?: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  typing?: boolean;
  at: number;
};

function run(bindings: readonly Binding[], presses: (Press | { blur: number })[]): Fired[] {
  let state = idleKeys;
  const fired: Fired[] = [];
  for (const press of presses) {
    const input: KeyInput =
      "blur" in press ? { type: "blur", at: press.blur } : { type: "down", ...press };
    const result = step(bindings, state, input);
    state = result.state;
    fired.push(...result.fired);
  }
  return fired;
}

const defs: ActionDef[] = [
  { id: "polygon", scope: "annotate", keys: ["P"], presets: { figma: ["⇧P"] } },
  { id: "preview", scope: "worklist", keys: ["P"] },
  { id: "peek", scope: "viewer", keys: ["Z"], hold: true, holdMs: 180 },
  { id: "area", scope: "viewer", keys: ["G then 1 … 3"] },
  { id: "next", scope: "review", keys: ["J", "↓"] },
  { id: "search", scope: "global", keys: ["⌘K"], inInputs: true },
  { id: "pan", scope: "viewer", keys: ["Arrows"] },
];

const registry = createActionRegistry(defs);

const actionsFor = (bindings: Binding[], key: string, code = "") =>
  run(bindings, [{ key, code, at: 0 }]).map((fired) => fired.action);

test("an action id can be registered only once", () => {
  assert.throws(
    () =>
      createActionRegistry([
        { id: "fit", scope: "viewer", keys: ["0"] },
        { id: "fit", scope: "review", keys: ["9"] },
      ]),
    /registered twice/,
  );
});

test("only the active scopes and the global scope are bound", () => {
  const ids = (scopes: ActionDef["scope"][]) => [
    ...new Set(registry.bindings({ scopes }).map((binding) => actionOf(binding.action).id)),
  ];
  assert.deepEqual(ids([]), ["search"]);
  assert.ok(ids(["worklist"]).includes("preview"));
  assert.ok(!ids(["worklist"]).includes("polygon"));
  assert.ok(ids(["viewer", "review"]).includes("next"));
});

test("the same key in a more specific scope shadows the less specific one", () => {
  const both = registry.bindings({ scopes: ["annotate", "worklist"] });
  assert.deepEqual(actionsFor(both, "p", "KeyP"), ["polygon"]);
  const worklist = registry.bindings({ scopes: ["worklist"] });
  assert.deepEqual(actionsFor(worklist, "p", "KeyP"), ["preview"]);
});

test("a key that starts a chord in a higher scope shadows a bare key below it", () => {
  const shadowed = createActionRegistry([
    { id: "outer", scope: "viewer", keys: ["G"] },
    { id: "inner", scope: "annotate", keys: ["G then 5"] },
  ]).bindings({ scopes: ["viewer", "annotate"] });
  assert.deepEqual(
    shadowed.map((binding) => binding.action),
    ["inner"],
  );
});

test("a numbered chord fires the action for the number", () => {
  const bindings = registry.bindings({ scopes: ["viewer"] });
  const fired = run(bindings, [
    { key: "g", code: "KeyG", at: 0 },
    { key: "2", code: "Digit2", at: 100 },
  ]);
  assert.deepEqual(
    fired.map((one) => one.action),
    ["area:2"],
  );
});

test("a range expands into one binding per number and the number reaches the caller", () => {
  assert.deepEqual(
    expandSlot("⇧1 … ⇧4").map(([suffix]) => suffix),
    [":1", ":2", ":3", ":4"],
  );
  assert.deepEqual(expandSlot("G then 1 … 9")[8], [":9", ["G", "9"]]);
  assert.deepEqual(expandSlot("⌥1 … ⌥6")[5], [":6", ["⌥6"]]);
  assert.deepEqual(actionOf("area:2"), { id: "area", suffix: "2" });
});

test("a direction set expands to four keys and a custom set swaps them", () => {
  const arrows = registry.bindings({ scopes: ["viewer"], only: ["pan"] });
  assert.deepEqual(
    arrows.map((binding) => [binding.action, binding.keys[0]]),
    [
      ["pan:up", "↑"],
      ["pan:down", "↓"],
      ["pan:left", "←"],
      ["pan:right", "→"],
    ],
  );
  const wasd = registry.bindings({
    scopes: ["viewer"],
    only: ["pan"],
    personal: { pan: ["WASD"] },
  });
  assert.deepEqual(actionsFor(wasd, "w", "KeyW"), ["pan:up"]);
  assert.deepEqual(actionsFor(wasd, "ArrowUp"), []);
});

test("an action can have several keys", () => {
  const bindings = registry.bindings({ scopes: ["review"] });
  assert.deepEqual(actionsFor(bindings, "j", "KeyJ"), ["next"]);
  assert.deepEqual(actionsFor(bindings, "ArrowDown"), ["next"]);
});

test("a preset replaces the default and personal keys replace the preset", () => {
  const scopes = ["annotate" as const];
  assert.deepEqual(actionsFor(registry.bindings({ scopes }), "p", "KeyP"), ["polygon"]);
  const figma = registry.bindings({ scopes, preset: "figma" });
  assert.deepEqual(actionsFor(figma, "p", "KeyP"), []);
  assert.deepEqual(
    run(figma, [{ key: "P", code: "KeyP", shiftKey: true, at: 0 }])[0]?.action,
    "polygon",
  );
  const personal = registry.bindings({ scopes, preset: "figma", personal: { polygon: ["Y"] } });
  assert.deepEqual(actionsFor(personal, "y", "KeyY"), ["polygon"]);
  const unnamed = registry.bindings({ scopes, preset: "qupath" });
  assert.deepEqual(actionsFor(unnamed, "p", "KeyP"), ["polygon"]);
});

test("an action with no keys has no binding", () => {
  const empty = createActionRegistry([{ id: "add", scope: "review", keys: [] }]);
  assert.deepEqual(empty.bindings({ scopes: ["review"] }), []);
});

test("Z under 180 ms is a tap, from 180 ms it is a hold", () => {
  const bindings = registry.bindings({ scopes: ["viewer"], only: ["peek"] });
  const release = (at: number) =>
    run(bindings, [
      { key: "z", code: "KeyZ", at: 0 },
      { type: "up", key: "z", code: "KeyZ", at },
    ]);
  assert.deepEqual(release(179).at(-1), { action: "peek", phase: "tap" });
  assert.deepEqual(release(180).at(-1), { action: "peek", phase: "hold-end" });
});

test("the hold threshold defaults to 350 ms when the action sets none", () => {
  const bindings = createActionRegistry([
    { id: "peek", scope: "viewer", keys: ["Z"], hold: true },
  ]).bindings({
    scopes: ["viewer"],
  });
  const release = (at: number) =>
    run(bindings, [
      { key: "z", code: "KeyZ", at: 0 },
      { type: "up", key: "z", code: "KeyZ", at },
    ]);
  assert.deepEqual(release(349).at(-1), { action: "peek", phase: "tap" });
  assert.deepEqual(release(350).at(-1), { action: "peek", phase: "hold-end" });
});

test("only actions marked for inputs fire while typing", () => {
  const bindings = registry.bindings({ scopes: ["viewer", "review"] });
  assert.deepEqual(run(bindings, [{ key: "j", code: "KeyJ", at: 0, typing: true }]), []);
  assert.deepEqual(run(bindings, [{ key: "z", code: "KeyZ", at: 0, typing: true }]), []);
  assert.deepEqual(
    run(bindings, [{ key: "k", code: "KeyK", metaKey: true, at: 0, typing: true }]),
    [{ action: "search", phase: "press" }],
  );
});

test("the shipped catalogue puts Z in the viewer and the review keys in review", () => {
  const viewer = keyRegistry.bindings({ scopes: ["viewer"] });
  assert.ok(viewer.some((binding) => binding.action === "peek" && binding.hold));
  assert.ok(!viewer.some((binding) => binding.action === "dnext"));
  const review = keyRegistry.bindings({ scopes: ["viewer", "review"] });
  assert.deepEqual(actionsFor(review, "j", "KeyJ"), ["dnext"]);
});

test("the shipped catalogue reads the chord, the question mark and the shifted digits", () => {
  const bindings = keyRegistry.bindings({ scopes: ["viewer"] });
  const chord = run(bindings, [
    { key: "g", code: "KeyG", at: 0 },
    { key: "4", code: "Digit4", at: 100 },
  ]);
  assert.deepEqual(chord, [{ action: "area:4", phase: "press" }]);
  assert.deepEqual(actionsFor(bindings, "?", "Slash"), ["sheet"]);
  assert.deepEqual(run(bindings, [{ key: "@", code: "Digit2", shiftKey: true, at: 0 }]), [
    { action: "preset:2", phase: "press" },
  ]);
});

test("the shipped catalogue lets Esc and the palette key through a text field", () => {
  const bindings = keyRegistry.bindings({ scopes: ["viewer"] });
  assert.deepEqual(run(bindings, [{ key: "Escape", at: 0, typing: true }]), [
    { action: "esc", phase: "press" },
  ]);
  assert.deepEqual(run(bindings, [{ key: "z", code: "KeyZ", at: 0, typing: true }]), []);
});

test("Shift+L links the compare panes in compare and draws an arrow in Annotate", () => {
  const press = { key: "L", code: "KeyL", shiftKey: true, at: 0 };
  const compare = keyRegistry.bindings({ scopes: ["viewer", "compare"] });
  assert.deepEqual(run(compare, [press]), [{ action: "linkviews", phase: "press" }]);
  const annotate = keyRegistry.bindings({ scopes: ["viewer", "annotate"] });
  assert.deepEqual(run(annotate, [press]), [{ action: "tarrow", phase: "press" }]);
  const both = keyRegistry.bindings({ scopes: ["compare", "annotate"] });
  assert.deepEqual(run(both, [press]), [{ action: "tarrow", phase: "press" }]);
});
