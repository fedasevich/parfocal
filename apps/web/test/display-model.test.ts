import assert from "node:assert/strict";
import { test } from "node:test";
import type { MyDisplay } from "@parfocal/api-client";
import {
  composeValues,
  fromApi,
  overridesOf,
  saveState,
  shiftPreset,
  taskDisplayView,
  toApi,
  withOtherSets,
} from "../src/screens/review/display-model.ts";

const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const stamp = "2026-10-15T10:00:00+02:00";

const standing = {
  draw_as: "outline",
  width: 2,
  colour_by: "class",
  id_labels: true,
  confidence: "number",
  heatmap: 0,
  score_cutoff: 0.4,
  order: "ai",
  zoom: "fit",
  move_on: true,
  buttons: "card",
} as const;

const mine = (over: Partial<MyDisplay> = {}): MyDisplay => ({
  task: {
    defaults: standing,
    locks: { order: "Everyone sees the same order", "score-cutoff": "Fixed for the round" },
  },
  preset_id: null,
  preset: "Task default",
  settings: standing,
  presets: [
    {
      id: id(1),
      name: "Tumor first",
      task_id: id(9),
      settings: { colour_by: "score", order: "largest-first" },
      created_at: stamp,
      updated_at: stamp,
    },
    {
      id: id(2),
      name: "Dots",
      task_id: null,
      settings: { draw_as: "dots", id_labels: false, confidence: "colour" },
      created_at: stamp,
      updated_at: stamp,
    },
  ],
  ...over,
});

test("API values map to the panel's words and back", () => {
  const panel = fromApi({
    confidence: "colour",
    order: "least-sure-first",
    buttons: "under-slide",
    width: 3,
  });
  assert.deepEqual(panel, {
    confidence: "color",
    order: "leastsure",
    buttons: "bottom",
    width: "3",
  });
  assert.deepEqual(toApi(panel), {
    confidence: "colour",
    order: "least-sure-first",
    buttons: "under-slide",
    width: 3,
  });
});

test("the task's locks carry the task default as the locked value", () => {
  const view = taskDisplayView(mine(), "RT-14");
  assert.deepEqual(
    view.locks.map((lock) => [lock.setting, lock.value]),
    [
      ["order", "ai"],
      ["cutoff", 0.4],
    ],
  );
  assert.equal(view.task_code, "RT-14");
});

test("the first three presets get Shift+2 to Shift+4 and the rest none", () => {
  const view = taskDisplayView(mine(), "RT-14");
  assert.deepEqual(
    view.presets.map((item) => item.key),
    ["⇧2", "⇧3"],
  );
});

test("Shift+1 is the task default and Shift+2 to Shift+4 the first three presets", () => {
  const view = taskDisplayView(mine(), "RT-14");
  assert.deepEqual(shiftPreset(view, 1), { name: null });
  assert.deepEqual(shiftPreset(view, 2), { name: "Tumor first" });
  assert.deepEqual(shiftPreset(view, 3), { name: "Dots" });
  assert.equal(shiftPreset(view, 4), null);
  assert.equal(shiftPreset(view, 5), null);
});

test("nothing is overridden on the task default and on a picked preset", () => {
  const view = taskDisplayView(mine(), "RT-14");
  assert.deepEqual(overridesOf(mine(), view), {});
  const picked = mine({
    preset_id: id(1),
    preset: "Tumor first",
    settings: { ...standing, colour_by: "score", order: "largest-first" },
  });
  assert.deepEqual(overridesOf(picked, view), {});
});

test("a changed value shows as an override and a locked one never does", () => {
  const view = taskDisplayView(mine(), "RT-14");
  const changed = mine({ settings: { ...standing, width: 3, order: "random" } });
  assert.deepEqual(overridesOf(changed, view), { width: "3" });
});

test("a preset that holds a locked value keeps the task's value", () => {
  const view = taskDisplayView(mine(), "RT-14");
  const values = composeValues(view, "Tumor first", {});
  assert.equal(values.order, "ai");
  assert.equal(values.colorBy, "score");
  assert.equal(values.cutoff, 0.4);
});

test("Save is blocked with a reason on the task default and with no change", () => {
  assert.deepEqual(saveState(false, "Dots"), { enabled: false, reason: "Nothing changed" });
  assert.equal(saveState(true, null).enabled, false);
  assert.match(saveState(true, null).reason ?? "", /Save as/);
  assert.deepEqual(saveState(true, "Dots"), { enabled: true, reason: undefined });
});

test("a display change keeps the saved other sets so a locked other-sets is not refused", () => {
  const kept = { other_sets: "hidden" } as unknown as Parameters<typeof withOtherSets>[1];
  const sent = withOtherSets({ opacity: 0.5 }, kept) as Record<string, unknown>;
  assert.equal(sent["other_sets"], "hidden");
  assert.equal(sent["opacity"], 0.5);
  assert.deepEqual(withOtherSets({ opacity: 0.5 }, undefined), { opacity: 0.5 });
});
