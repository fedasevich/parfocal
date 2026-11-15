import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModelRun } from "@parfocal/api-client";
import {
  annotateRunDraft,
  joinableSetOf,
  runEnded,
  selectionScopeOf,
  viewScopeOf,
} from "../src/annotations/annotate-run.ts";
import { addShape, createDocument } from "../src/annotations/document.ts";

const task = { taskId: "task-1", slideId: "slide-1" };

function drawn() {
  const polygon = addShape(createDocument(), {
    kind: "polygon",
    points: Float32Array.of(100, 100, 400, 120, 380, 360),
  });
  const rectangle = addShape(polygon.document, {
    kind: "rectangle",
    points: Float32Array.of(600, 500, 800, 700),
  });
  const marker = addShape(rectangle.document, { kind: "point", points: Float32Array.of(50, 50) });
  return {
    shapes: marker.document.shapes,
    polygon: polygon.shape.id,
    rectangle: rectangle.shape.id,
    marker: marker.shape.id,
  };
}

test("a selected polygon becomes the selection scope with its own closed outline", () => {
  const { shapes, polygon } = drawn();
  assert.deepEqual(selectionScopeOf(shapes, [polygon]), {
    kind: "selection",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [100, 100],
          [400, 120],
          [380, 360],
          [100, 100],
        ],
      ],
    },
  });
});

test("several selected shapes run on the box around them, and open shapes are left out", () => {
  const { shapes, polygon, rectangle, marker } = drawn();
  assert.deepEqual(selectionScopeOf(shapes, [polygon, marker, rectangle])?.geometry, {
    type: "Polygon",
    coordinates: [
      [
        [100, 100],
        [800, 100],
        [800, 700],
        [100, 700],
        [100, 100],
      ],
    ],
  });
  assert.equal(selectionScopeOf(shapes, [marker]), null);
  assert.equal(selectionScopeOf(shapes, []), null);
});

test("the current view becomes a view scope clamped to the slide in whole pixels", () => {
  const slide = { width: 2048, height: 1536 };
  assert.deepEqual(viewScopeOf({ x: -40.4, y: 200.6, width: 1000, height: 400 }, slide), {
    kind: "view",
    x: 0,
    y: 201,
    width: 960,
    height: 400,
  });
  assert.deepEqual(viewScopeOf({ x: 1800, y: 1400, width: 900, height: 900 }, slide), {
    kind: "view",
    x: 1800,
    y: 1400,
    width: 248,
    height: 136,
  });
  assert.equal(viewScopeOf({ x: 3000, y: 0, width: 100, height: 100 }, slide), null);
});

test("a run from the Annotate workspace carries the task and one slide", () => {
  const { shapes, polygon } = drawn();
  const selection = selectionScopeOf(shapes, [polygon]);
  assert.ok(selection);
  const fromSelection = annotateRunDraft({ ...task, scope: selection });
  assert.deepEqual(fromSelection.slide_ids, ["slide-1"]);
  assert.equal(fromSelection.task_id, "task-1");
  assert.equal(fromSelection.scope.kind, "selection");
  assert.deepEqual(fromSelection.parameters, { detector: { name: "hovernet" } });

  const view = viewScopeOf({ x: 10, y: 20, width: 300, height: 200 }, { width: 999, height: 999 });
  assert.ok(view);
  assert.deepEqual(annotateRunDraft({ ...task, scope: view }).scope, {
    kind: "view",
    x: 10,
    y: 20,
    width: 300,
    height: 200,
  });
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
