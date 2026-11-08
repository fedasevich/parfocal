import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  hudShown,
  labDefaults,
  modelsPausedWhileMoving,
  nucleiCountOf,
  parseLabSettings,
  readLabSettings,
  resetLabSettings,
  setLabSetting,
  subscribeLabSettings,
  vivSwitchesOf,
} from "../src/lab/lab-settings.ts";

const storage = new Map<string, string>();

Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  },
});

beforeEach(() => {
  resetLabSettings();
  storage.clear();
});

test("the defaults match the mock: Viv, GPU culling, prefetch on, HUD on, models paused", () => {
  assert.deepEqual(readLabSettings(), labDefaults);
  assert.equal(labDefaults.renderer, "viv");
  assert.equal(labDefaults.culling, "gpu");
  assert.equal(labDefaults.prefetch, true);
  assert.equal(labDefaults.motionVector, false);
  assert.equal(labDefaults.detailLevel, "tiered");
  assert.equal(labDefaults.nuclei, "100k");
});

test("the renderer control keeps its choice", () => {
  setLabSetting("renderer", "webgpu");
  assert.equal(readLabSettings().renderer, "webgpu");
});

test("the culling control keeps its choice", () => {
  setLabSetting("culling", "cpu");
  assert.equal(readLabSettings().culling, "cpu");
});

test("the interpolation control reaches the Viv route only when linear", () => {
  assert.equal(vivSwitchesOf(readLabSettings()).interpolation, undefined);
  setLabSetting("interpolation", "linear");
  assert.equal(vivSwitchesOf(readLabSettings()).interpolation, "linear");
  setLabSetting("interpolation", "nearest");
  assert.equal(vivSwitchesOf(readLabSettings()).interpolation, undefined);
});

test("the prefetch control reaches the Viv route", () => {
  assert.equal(vivSwitchesOf(readLabSettings()).prefetch, true);
  setLabSetting("prefetch", false);
  assert.equal(vivSwitchesOf(readLabSettings()).prefetch, false);
});

test("the motion vector control keeps its choice", () => {
  setLabSetting("motionVector", true);
  assert.equal(readLabSettings().motionVector, true);
});

test("the detail level control keeps its choice", () => {
  setLabSetting("detailLevel", "dots");
  assert.equal(readLabSettings().detailLevel, "dots");
});

test("the synthetic nuclei control gives the counts of the mock", () => {
  const counts = (["off", "10k", "100k", "500k", "1M"] as const).map((key) => {
    setLabSetting("nuclei", key);
    return nucleiCountOf(readLabSettings());
  });
  assert.deepEqual(counts, [0, 10_000, 100_000, 500_000, 1_000_000]);
});

test("the HUD control hides and shows the HUD", () => {
  assert.equal(hudShown(readLabSettings()), true);
  setLabSetting("hud", false);
  assert.equal(hudShown(readLabSettings()), false);
});

test("the pause models control keeps its choice", () => {
  assert.equal(modelsPausedWhileMoving(readLabSettings()), true);
  setLabSetting("pauseModels", false);
  assert.equal(modelsPausedWhileMoving(readLabSettings()), false);
});

test("a change is stored, announced and read back after a reload", () => {
  let heard = 0;
  const stop = subscribeLabSettings(() => {
    heard += 1;
  });
  setLabSetting("culling", "none");
  stop();
  setLabSetting("hud", false);
  assert.equal(heard, 1);
  const reloaded = parseLabSettings(storage.get("parfocal-lab-settings") ?? null);
  assert.equal(reloaded.culling, "none");
  assert.equal(reloaded.hud, false);
});

test("stored junk falls back to the defaults", () => {
  assert.deepEqual(parseLabSettings("not json"), labDefaults);
  assert.deepEqual(parseLabSettings('{"culling":"banana","hud":3}'), labDefaults);
});
