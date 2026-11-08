import assert from "node:assert/strict";
import { test } from "node:test";
import type { Preset } from "../src/keys/actions.ts";
import { keyRegistry } from "../src/keys/catalogue.ts";

const scopes = ["viewer", "review", "compare", "annotate", "worklist"] as const;

const keysOf = (preset: Preset, action: string) =>
  keyRegistry
    .bindings({ preset, scopes, only: [action] })
    .filter((binding) => binding.action === action)
    .map((binding) => binding.keys.join("+"));

const toolIds = keyRegistry.defs.filter((def) => def.presets !== undefined).map((def) => def.id);

test("the viewer default keeps every tool on its own key", () => {
  assert.deepEqual(keysOf("default", "tselect"), ["V"]);
  assert.deepEqual(keysOf("default", "tmarker"), ["M"]);
  assert.deepEqual(keysOf("default", "truler"), ["L"]);
});

test("the QuPath-like preset moves select, wand, ellipse and points", () => {
  assert.deepEqual(keysOf("qupath", "tselect"), ["M"]);
  assert.deepEqual(keysOf("qupath", "tsmart"), ["W"]);
  assert.deepEqual(keysOf("qupath", "tellipse"), ["E"]);
  assert.deepEqual(keysOf("qupath", "tmarker"), ["."]);
  assert.deepEqual(keysOf("qupath", "tpoly"), ["P"]);
});

test("the Figma-like preset moves the ruler off the line key", () => {
  assert.deepEqual(keysOf("figma", "truler"), ["⇧R"]);
  assert.deepEqual(keysOf("figma", "tselect"), ["V"]);
});

test("presets change tool keys only, review and global keys stay", () => {
  assert.ok(toolIds.length > 0);
  assert.ok(toolIds.every((id) => id.startsWith("t")));
  const only = keyRegistry.defs.map((def) => def.id).filter((id) => !toolIds.includes(id));
  const base = JSON.stringify(keyRegistry.bindings({ preset: "default", scopes, only }));
  for (const preset of ["qupath", "figma"] as const)
    assert.equal(JSON.stringify(keyRegistry.bindings({ preset, scopes, only })), base);
});

test("a personal key beats the preset", () => {
  const [binding] = keyRegistry.bindings({
    preset: "qupath",
    scopes,
    personal: { tselect: ["X"] },
    only: ["tselect"],
  });
  assert.deepEqual(binding?.keys, ["X"]);
});
