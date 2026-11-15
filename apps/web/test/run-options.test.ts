import assert from "node:assert/strict";
import { test } from "node:test";
import { buildRunDraft, defaultRunOptions, viewScopeOf } from "../src/viewer/run-options.ts";

const slide = { width: 1000, height: 800 };

test("the default run is the whole slide with fixed settings", () => {
  const draft = buildRunDraft({ slideId: "s1", options: defaultRunOptions, view: null });
  assert.deepEqual(draft, {
    slide_ids: ["s1"],
    scope: { kind: "slide" },
    parameters: { detector: { name: "hovernet" }, test_time_views: 1, ordering: "raster" },
  });
});

test("a view run carries the visible rectangle and the chosen options", () => {
  const draft = buildRunDraft({
    slideId: "s1",
    options: { scope: "view", views: 8, ordering: "tumor-first" },
    view: { x: 10, y: 20, width: 300, height: 200 },
  });
  assert.deepEqual(draft?.scope, { kind: "view", x: 10, y: 20, width: 300, height: 200 });
  assert.equal(draft?.parameters.test_time_views, 8);
  assert.equal(draft?.parameters.ordering, "tumor-first");
});

test("a view run without a view does not build", () => {
  const draft = buildRunDraft({
    slideId: "s1",
    options: { ...defaultRunOptions, scope: "view" },
    view: null,
  });
  assert.equal(draft, null);
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
