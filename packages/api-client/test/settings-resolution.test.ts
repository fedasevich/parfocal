import assert from "node:assert/strict";
import { test } from "node:test";
import {
  catalogue,
  type SettingEntry,
  type SettingKey,
} from "../src/settings/catalogue.generated.ts";
import {
  resolveSetting,
  resolveSettings,
  type SettingLayers,
  type Source,
} from "../src/settings/resolve.ts";

const keys = Object.keys(catalogue) as SettingKey[];

const other = (entry: SettingEntry): unknown => {
  switch (entry.kind) {
    case "choice":
      return (entry.options ?? []).at(-1);
    case "switch":
      return !entry.default;
    case "whole":
      return entry.minimum;
  }
};

const empty = (): SettingLayers => ({ lab: { values: {}, locked: [] }, personal: {}, device: {} });

type Combination = { lab: boolean; locked: boolean; personal: boolean; device: boolean };

const combinations: Combination[] = [false, true].flatMap((lab) =>
  [false, true].flatMap((locked) =>
    [false, true].flatMap((personal) =>
      [false, true].map((device) => ({ lab, locked, personal, device })),
    ),
  ),
);

const expected = (entry: SettingEntry, given: Combination): Source => {
  const allows = (layer: "lab" | "personal" | "device") => entry.layers.includes(layer);
  if (given.lab && given.locked && allows("lab")) return "lab-locked";
  if (given.personal && allows("personal")) return "personal";
  if (given.device && allows("device")) return "device";
  if (given.lab && allows("lab")) return "lab";
  return "default";
};

test("every key resolves in the order lab locked, personal, device, lab, default", () => {
  for (const key of keys) {
    const entry = catalogue[key];
    for (const given of combinations) {
      const layers = empty();
      const value = other(entry);
      if (given.lab) layers.lab.values[key] = value;
      if (given.locked) layers.lab.locked = [key];
      if (given.personal) layers.personal[key] = value;
      if (given.device) layers.device[key] = value;
      const resolved = resolveSetting(key, layers);
      const source = expected(entry, given);
      assert.equal(resolved.source, source, `${key} ${JSON.stringify(given)}`);
      assert.equal(resolved.value, source === "default" ? entry.default : value);
      assert.equal(resolved.locked, source === "lab-locked");
    }
  }
});

test("a locked lab value wins over a personal one", () => {
  const layers = empty();
  layers.lab = { values: { patient_names: "initials" }, locked: ["patient_names"] };
  layers.personal = { patient_names: "full" };
  assert.deepEqual(resolveSetting("patient_names", layers), {
    value: "initials",
    source: "lab-locked",
    locked: true,
  });
});

test("an unlocked lab value is the workspace default under personal choices", () => {
  const layers = empty();
  layers.lab.values = { patient_names: "initials" };
  assert.equal(resolveSetting("patient_names", layers).source, "lab");
  layers.personal = { patient_names: "full" };
  assert.equal(resolveSetting("patient_names", layers).value, "full");
});

test("a value in a layer the key does not allow is ignored", () => {
  const layers = empty();
  layers.personal = { theme: "dark", decision_cutoff: 10 };
  layers.device = { decision_cutoff: 20 };
  assert.equal(resolveSetting("theme", layers).source, "default");
  assert.equal(resolveSetting("decision_cutoff", layers).value, 50);
});

test("a stale or mistyped device value falls back", () => {
  const layers = empty();
  layers.device = { theme: "sepia", slide_brightness: 400, invert_zoom: "yes" };
  assert.equal(resolveSetting("theme", layers).value, "system");
  assert.equal(resolveSetting("slide_brightness", layers).value, 100);
  assert.equal(resolveSetting("invert_zoom", layers).value, false);
});

test("resolving everything gives a value for every key", () => {
  const all = resolveSettings(empty());
  assert.deepEqual(Object.keys(all).sort(), [...keys].sort());
  for (const key of keys) assert.equal(all[key], catalogue[key].default);
});
