import assert from "node:assert/strict";
import { test } from "node:test";
import { type LabSettings, labDefaults } from "../src/lab/lab-settings.ts";
import { detailDraw, insideView, labViewerPlan } from "../src/viewer/lab-plan.ts";

const plan = (change: Partial<LabSettings>) => labViewerPlan({ ...labDefaults, ...change });

test("the renderer choice keeps Viv without a note and falls back with one for unbuilt routes", () => {
  assert.equal(plan({ renderer: "viv" }).routeNote, null);
  assert.match(plan({ renderer: "webgpu" }).routeNote ?? "", /WebGPU route is not built yet/);
  assert.match(plan({ renderer: "deck" }).routeNote ?? "", /deck\.gl route is not built yet/);
  assert.equal(plan({ renderer: "deck" }).route, "viv");
});

test("the culling choice decides whether the viewer culls", () => {
  assert.equal(plan({ culling: "gpu" }).cull, true);
  assert.equal(plan({ culling: "cpu" }).cull, true);
  assert.equal(plan({ culling: "none" }).cull, false);
});

test("the detail choice decides how a nucleus is drawn", () => {
  assert.equal(plan({ detailLevel: "dots" }).detailLevel, "dots");
  assert.equal(detailDraw("off", 0.1).mode, "circle");
  assert.equal(detailDraw("dots", 20).mode, "dot");
  assert.equal(detailDraw("density", 20).mode, "density");
  assert.equal(detailDraw("fade", 1.5).alpha, 0.5);
  assert.equal(detailDraw("tiered", 5).mode, "circle");
  assert.equal(detailDraw("tiered", 1).mode, "dot");
  assert.equal(detailDraw("tiered", 0.2).mode, "density");
});

test("the nuclei choice sets how many nuclei the viewer draws", () => {
  assert.equal(plan({ nuclei: "off" }).nucleiCount, 0);
  assert.equal(plan({ nuclei: "500k" }).nucleiCount, 500_000);
});

test("the HUD, motion vector and pause choices reach the viewer plan", () => {
  assert.equal(plan({ hud: false }).hud, false);
  assert.equal(plan({ motionVector: true }).motionVector, true);
  assert.equal(plan({ pauseModels: false }).pauseModels, false);
});

test("culling keeps only points inside the view", () => {
  const view = { left: 0, top: 0, right: 10, bottom: 10 };
  assert.equal(insideView(view, 5, 5), true);
  assert.equal(insideView(view, 11, 5), false);
});
