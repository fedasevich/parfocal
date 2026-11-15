import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelRun } from "@parfocal/api-client";
import { joinableSetOf, runEnded } from "../src/annotations/annotate-run.ts";
import { buildRunDraft, canRunModels, viewScopeOf } from "../src/viewer/run-options.ts";

const task = { taskId: "task-1", slideId: "slide-1" };

test("a run on the selection from an annotate task carries the task and the selected box", () => {
  const draft = buildRunDraft({
    slideId: "slide-1",
    options: { scope: "selection", ordering: "raster" },
    view: null,
    selection: { x: 100, y: 100, width: 300, height: 260 },
    taskId: "task-1",
  });
  assert.deepEqual(draft, {
    slide_ids: ["slide-1"],
    task_id: "task-1",
    scope: {
      kind: "selection",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [100, 100],
            [400, 100],
            [400, 360],
            [100, 360],
            [100, 100],
          ],
        ],
      },
    },
    parameters: { detector: { name: "hovernet" }, ordering: "raster" },
  });
});

test("a run on the view from an annotate task carries the task and the view", () => {
  const view = viewScopeOf(
    { x: -40.4, y: 200.6, width: 1000, height: 400 },
    { width: 2048, height: 1536 },
  );
  const draft = buildRunDraft({
    slideId: "slide-1",
    options: { scope: "view", ordering: "raster" },
    view,
    taskId: "task-1",
  });
  assert.equal(draft?.task_id, "task-1");
  assert.deepEqual(draft?.scope, { kind: "view", x: 0, y: 201, width: 960, height: 400 });
  const outside = buildRunDraft({
    slideId: "slide-1",
    options: { scope: "view", ordering: "raster" },
    view: null,
  });
  assert.equal(outside, null);
});

test("a run outside a task carries no task", () => {
  const draft = buildRunDraft({
    slideId: "slide-1",
    options: { scope: "slide", ordering: "raster" },
    view: null,
    taskId: null,
  });
  assert.equal(draft !== null && "task_id" in draft, false);
});

test("only a researcher who owns the project may run models, as the API's matrix says", () => {
  assert.equal(canRunModels({ tenantRole: "researcher", projectRole: "owner" }), true);
  assert.equal(canRunModels({ tenantRole: "researcher", projectRole: "reviewer" }), false);
  assert.equal(canRunModels({ tenantRole: "reviewer", projectRole: "owner" }), false);
  assert.equal(canRunModels({ tenantRole: undefined, projectRole: undefined }), false);
});

const run = (patch: Partial<ModelRun>) =>
  ({
    status: "done",
    task_id: "task-1",
    slide_id: "slide-1",
    result_set_id: "set-1",
    ...patch,
  }) as Pick<ModelRun, "status" | "task_id" | "slide_id" | "result_set_id">;

test("only a finished run of this task slide joins the task", () => {
  assert.equal(joinableSetOf(run({}), task), "set-1");
  assert.equal(joinableSetOf(run({ status: "cancelled" }), task), null);
  assert.equal(joinableSetOf(run({ status: "running" }), task), null);
  assert.equal(joinableSetOf(run({ task_id: null }), task), null);
  assert.equal(joinableSetOf(run({ slide_id: "slide-2" }), task), null);
  assert.equal(joinableSetOf(run({ result_set_id: null }), task), null);
  assert.deepEqual(
    (["queued", "running", "paused", "cancelling", "done", "cancelled", "failed"] as const).filter(
      runEnded,
    ),
    ["done", "cancelled", "failed"],
  );
});
