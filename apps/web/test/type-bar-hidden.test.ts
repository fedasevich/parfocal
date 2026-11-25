import assert from "node:assert/strict";
import { test } from "node:test";
import { readDeviceSettings, writeDeviceSetting } from "../src/shell/device-settings.ts";
import { readTypeBarHidden, typeBarHiddenKey } from "../src/viewer/type-bar-hidden.ts";

function memory() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

test("the type bar is shown until the reviewer hides it", () => {
  assert.equal(readTypeBarHidden(memory()), false);
});

test("a hidden type bar is remembered with the device settings", () => {
  const storage = memory();
  writeDeviceSetting(typeBarHiddenKey, true, storage);
  assert.equal(readTypeBarHidden(storage), true);
  assert.equal(readDeviceSettings(storage)[typeBarHiddenKey], true);
  writeDeviceSetting(typeBarHiddenKey, false, storage);
  assert.equal(readTypeBarHidden(storage), false);
});

test("a stored value that is not true leaves the bar shown", () => {
  const storage = memory();
  writeDeviceSetting(typeBarHiddenKey, "yes", storage);
  assert.equal(readTypeBarHidden(storage), false);
});
