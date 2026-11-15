import assert from "node:assert/strict";
import { test } from "node:test";
import {
  boxGeometry,
  buildRunDraft,
  canTuneRun,
  defaultRunOptions,
  viewScopeOf,
} from "../src/viewer/run-options.ts";

const slide = { width: 1000, height: 800 };

test("the default run is the whole slide with fixed settings", () => {
  const draft = buildRunDraft({ slideId: "s1", options: defaultRunOptions, view: null });
  assert.deepEqual(draft, {
    slide_ids: ["s1"],
    scope: { kind: "slide" },
    parameters: { detector: { name: "hovernet" }, ordering: "raster" },
  });
});

test("a view run carries the visible rectangle and the chosen ordering", () => {
  const draft = buildRunDraft({
    slideId: "s1",
    options: { scope: "view", ordering: "tumor-first" },
    view: { x: 10, y: 20, width: 300, height: 200 },
  });
  assert.deepEqual(draft?.scope, { kind: "view", x: 10, y: 20, width: 300, height: 200 });
  assert.equal(draft?.parameters.ordering, "tumor-first");
});

test("a selection run carries the bounding box as a polygon", () => {
  const box = { x: 10, y: 20, width: 30, height: 40 };
  const draft = buildRunDraft({
    slideId: "s1",
    options: { ...defaultRunOptions, scope: "selection" },
    view: null,
    selection: box,
  });
  assert.deepEqual(draft?.scope, { kind: "selection", geometry: boxGeometry(box) });
  assert.deepEqual(boxGeometry(box).coordinates[0]?.[2], [40, 60]);
});

test("a view or selection run without its region does not build", () => {
  for (const scope of ["view", "selection"] as const) {
    const draft = buildRunDraft({
      slideId: "s1",
      options: { ...defaultRunOptions, scope },
      view: null,
    });
    assert.equal(draft, null);
  }
});

test("the view is clamped to the slide and rounded", () => {
  assert.deepEqual(viewScopeOf({ x: -50, y: 10.4, width: 2000, height: 100.6 }, slide), {
    x: 0,
    y: 10,
    width: 1000,
    height: 101,
  });
});

test("a view outside the slide gives no scope", () => {
  assert.equal(viewScopeOf({ x: 2000, y: 0, width: 100, height: 100 }, slide), null);
});

test("options are for researchers and project owners, not doctors", () => {
  assert.equal(canTuneRun({ tenantRole: "researcher", projectRole: "viewer" }), true);
  assert.equal(canTuneRun({ tenantRole: "reviewer", projectRole: "owner" }), true);
  assert.equal(canTuneRun({ tenantRole: "reviewer", projectRole: "reviewer" }), false);
  assert.equal(canTuneRun({ tenantRole: undefined, projectRole: undefined }), false);
});
