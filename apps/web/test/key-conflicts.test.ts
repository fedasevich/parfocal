import assert from "node:assert/strict";
import { test } from "node:test";
import type { Preset, Scope } from "../src/keys/actions.ts";
import { keyRegistry } from "../src/keys/catalogue.ts";
import { type Binding, conflicts } from "../src/keys/registry.ts";

const presets: Preset[] = ["default", "qupath", "figma"];

const screens: Record<string, Scope[]> = {
  worklist: ["worklist"],
  viewer: ["viewer"],
  annotate: ["viewer", "annotate"],
  review: ["viewer", "review"],
  "review with annotate": ["viewer", "review", "annotate"],
  compare: ["viewer", "compare"],
  "compare with annotate": ["viewer", "compare", "annotate"],
};

const decisionStyles: Record<string, string[]> = {
  "the certainty style": ["dclass"],
  "the class style": ["dcert"],
  "the other styles": ["dcert", "dclass"],
};

function onScreen(preset: Preset, scopes: Scope[], leave: string[] = []): Binding[] {
  const only = keyRegistry.defs.map((def) => def.id).filter((id) => !leave.includes(id));
  return keyRegistry.bindings({ preset, scopes, only });
}

for (const preset of presets)
  for (const [screen, scopes] of Object.entries(screens))
    for (const [style, leave] of Object.entries(decisionStyles))
      test(`no two actions share a key on ${screen} with the ${preset} preset and ${style}`, () => {
        assert.deepEqual(conflicts(onScreen(preset, scopes, leave)), []);
      });

test("a shared key is reported when two actions of one rank use it", () => {
  const bindings = keyRegistry.bindings({ scopes: ["viewer", "review", "compare"] });
  assert.ok(conflicts(bindings).length > 0);
});

test("the arrow tool and the link toggle share Shift+L and never meet", () => {
  const annotate = onScreen("default", ["viewer", "annotate"]);
  const compare = onScreen("default", ["viewer", "compare"]);
  assert.ok(annotate.some((binding) => binding.action === "tarrow"));
  assert.ok(!annotate.some((binding) => binding.action === "linkviews"));
  assert.ok(compare.some((binding) => binding.action === "linkviews"));
  assert.ok(!compare.some((binding) => binding.action === "tarrow"));
});
