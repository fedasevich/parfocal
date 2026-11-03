import assert from "node:assert/strict";
import { test } from "node:test";
import { type DeviceStorage, readDeviceSettings } from "../src/shell/device-settings.ts";
import { applyTheme, readTheme } from "../src/shell/theme.ts";

const memory = (
  initial: Record<string, string> = {},
): DeviceStorage & { items: Map<string, string> } => {
  const items = new Map(Object.entries(initial));
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
    removeItem: (key) => void items.delete(key),
  };
};

const root = () => ({ dataset: {} as Record<string, string> }) as unknown as HTMLElement;

test("the theme defaults to system as the settings catalogue says", () => {
  assert.equal(readTheme(memory()), "system");
});

test("the theme is read from the device layer and ignores values it does not know", () => {
  assert.equal(readTheme(memory({ "parfocal.device-settings": '{"theme":"light"}' })), "light");
  assert.equal(readTheme(memory({ "parfocal.device-settings": '{"theme":"sepia"}' })), "system");
  assert.equal(readTheme(memory({ "parfocal.device-settings": "not json" })), "system");
});

test("the old theme key moves into the device layer once and is removed", () => {
  const storage = memory({ "parfocal-theme": "light" });
  assert.equal(readTheme(storage), "light");
  assert.equal(storage.items.has("parfocal-theme"), false);
  assert.deepEqual(JSON.parse(storage.items.get("parfocal.device-settings") ?? ""), {
    theme: "light",
  });
  const chosen = memory({
    "parfocal-theme": "light",
    "parfocal.device-settings": '{"theme":"dark"}',
  });
  assert.deepEqual(readDeviceSettings(chosen), { theme: "dark" });
  assert.equal(chosen.items.has("parfocal-theme"), false);
});

test("the theme writes data-theme on the root like data-motion and data-density", () => {
  const element = root();
  applyTheme("light", element, false);
  assert.equal(element.dataset["theme"], "light");
  applyTheme("dark", element, true);
  assert.equal(element.dataset["theme"], "dark");
  applyTheme("system", element, true);
  assert.equal(element.dataset["theme"], "light");
  applyTheme("system", element, false);
  assert.equal(element.dataset["theme"], "dark");
});
