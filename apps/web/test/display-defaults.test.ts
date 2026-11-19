import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultDisplayDefaults,
  personalPanelValues,
  readDisplayDefaults,
} from "../src/shell/display-defaults.ts";
import { paintFor, safePalette } from "../src/viewer/class-paint.ts";

const storageOf = (values: Record<string, unknown>) => ({
  getItem: (key: string) => (key === "parfocal.device-settings" ? JSON.stringify(values) : null),
  setItem: () => undefined,
  removeItem: () => undefined,
});

test("nothing stored reads the factory defaults", () => {
  assert.deepEqual(readDisplayDefaults(storageOf({})), defaultDisplayDefaults);
});

test("stored values are snapped, clamped and checked", () => {
  const read = readDisplayDefaults(
    storageOf({
      "display.fillOpacity": 3,
      "display.heatmapOpacity": 64,
      "display.confidence": "nonsense",
      "display.colormap": "turbo",
      "display.textSize": "large",
      "display.classPalette": "safe",
    }),
  );
  assert.equal(read.fillOpacity, 20);
  assert.equal(read.heatmapOpacity, 60);
  assert.equal(read.confidence, "number");
  assert.equal(read.colormap, "turbo");
  assert.equal(read.textSize, "large");
  assert.equal(read.classPalette, "safe");
});

test("only the choices that differ from the factory reach the display state", () => {
  assert.deepEqual(personalPanelValues(defaultDisplayDefaults), {});
  const changed = { ...defaultDisplayDefaults, fillOpacity: 60, confidence: "word" as const };
  assert.deepEqual(personalPanelValues(changed), { opacity: 60, confidence: "word" });
});

test("the color-blind safe palette gives every class one of the safe colors", () => {
  const colours = ["Tumor", "Stroma", "Immune", "Other", "Neoplastic"].map(
    (name) => paintFor(name, [], null, "safe").hex,
  );
  for (const colour of colours)
    assert.ok(
      safePalette.some((safe) => safe === colour),
      colour,
    );
  assert.equal(new Set(colours.slice(0, 4)).size, 4);
  assert.notEqual(
    paintFor("Tumor", [], null, "standard").hex,
    paintFor("Tumor", [], null, "safe").hex,
  );
});
