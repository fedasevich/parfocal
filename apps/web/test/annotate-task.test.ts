import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  AnnotateSlideStatus,
  LayerObject,
  ProjectClass,
  ReviewTaskDetail,
} from "@parfocal/api-client";
import {
  aiCheckCounts,
  aiResultViewOf,
  aiWithChecks,
  annotateTaskOf,
  canSignOff,
  classCountsOf,
  layerKnownOf,
  nextSlideOf,
  originMarkOf,
  slideStepOf,
  taskClassesOf,
  taskProgressOf,
} from "../src/annotations/annotate-task.ts";
import type { SharedAiObject } from "../src/annotations/annotate-task-api.ts";

const cls = (key: number, name: string): ProjectClass => ({
  id: `class-${key}`,
  key,
  name,
  colour: "#fff",
});

const project = [cls(2, "Stroma"), cls(1, "Tumor")];
const snapshot = [cls(3, "Mitosis"), cls(1, "Tumor cell"), cls(2, "Lymphocyte")];

const square = {
  type: "Polygon" as const,
  coordinates: [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ] as [number, number][],
  ],
};

const ai = (object: string, classId: string | null = null): SharedAiObject => ({
  object,
  kind: "cell",
  number: Number(object.slice(1)),
  class_id: classId,
  score: 0.5,
  geometry: square,
});

const layerObject = (patch: Partial<LayerObject>): LayerObject => ({
  id: "id",
  slide_id: "s1",
  kind: "region",
  number: 1,
  code: "T+1",
  origin: "human",
  source: null,
  geometry: {},
  class_id: null,
  text: null,
  version: 1,
  created_by_user_id: "anna",
  changed_by_user_id: "simona",
  created_at: "2026-11-08T10:00:00Z",
  updated_at: "2026-11-08T10:00:00Z",
  deleted_at: null,
  ...patch,
});

const status = (patch: Partial<AnnotateSlideStatus>): AnnotateSlideStatus => ({
  task_id: "t",
  slide_id: "s",
  experts: [{ user_id: "me", checked_at: null, nothing_to_mark: false }],
  signed_off_at: null,
  signed_off_by_user_id: null,
  open_threads: 0,
  unchecked_objects: 0,
  all_checked_required: false,
  check_progress: null,
  ...patch,
});

const checked = (user = "me") => ({
  user_id: user,
  checked_at: "2026-11-08T11:00:00Z",
  nothing_to_mark: false,
});

test("the class strip comes from the task snapshot, ordered by key", () => {
  const classes = taskClassesOf(snapshot, project);
  assert.deepEqual(
    classes.map((item) => item.name),
    ["Tumor cell", "Lymphocyte", "Mitosis"],
  );
});

test("without a snapshot the strip falls back to the project classes", () => {
  assert.deepEqual(
    taskClassesOf(null, project).map((item) => item.name),
    ["Tumor", "Stroma"],
  );
});

test("the AI result is shown by default and the toggle hides it", () => {
  assert.deepEqual(aiResultViewOf("rs1", "PathoSAM", false), {
    available: true,
    shown: true,
    label: "AI result on · PathoSAM",
  });
  assert.deepEqual(aiResultViewOf("rs1", "PathoSAM", true), {
    available: true,
    shown: false,
    label: "AI result hidden",
  });
});

test("a slide with no result set has no AI toggle to show and nothing shown", () => {
  const view = aiResultViewOf(null, null, false);
  assert.equal(view.available, false);
  assert.equal(view.shown, false);
  assert.equal(view.label, "No AI result on this slide");
  const task = annotateTaskOf(
    {
      id: "t",
      kind: "annotate",
      classes: snapshot,
      slides: [
        { slide_id: "a", result_set_id: "rs1", reviewer_ids: [] },
        { slide_id: "b", result_set_id: null, reviewer_ids: [] },
      ],
    } as unknown as ReviewTaskDetail,
    "b",
    false,
  );
  assert.equal(task?.resultSetId, null);
  assert.deepEqual(task?.slideIds, ["a", "b"]);
  assert.equal(annotateTaskOf({ kind: "review" } as ReviewTaskDetail, "b", false), null);
});

test("origin marks name who drew a shape or who changed an AI object", () => {
  assert.deepEqual(originMarkOf(layerObject({ origin: "human" })), {
    origin: "human",
    authorId: "anna",
  });
  assert.deepEqual(originMarkOf(layerObject({ origin: "ai-edited" })), {
    origin: "ai-edited",
    authorId: "simona",
  });
  assert.deepEqual(originMarkOf(layerObject({ origin: "ai-confirmed" })), {
    origin: "ai-confirmed",
    authorId: "simona",
  });
});

test("AI objects take their check state and origin from their copies on the layer", () => {
  const merged = aiWithChecks(
    [ai("C1"), ai("C2"), ai("C3"), ai("C4")],
    [
      layerObject({ source: "C1", origin: "ai-confirmed" }),
      layerObject({ source: "C2", origin: "ai-edited" }),
      layerObject({ source: "C3", origin: "ai-edited", deleted_at: "2026-11-08T11:00:00Z" }),
      layerObject({ source: null }),
    ],
  );
  assert.deepEqual(
    merged.map((item) => [item.object, item.check, item.origin]),
    [
      ["C1", "confirmed", "ai-confirmed"],
      ["C2", "edited", "ai-edited"],
      ["C3", "deleted", "ai-edited"],
      ["C4", "unchecked", "ai"],
    ],
  );
  assert.deepEqual(aiCheckCounts(merged), { total: 4, confirmed: 1, edited: 1, deleted: 1 });
});

test("counts per class count every object of each class", () => {
  const counts = classCountsOf(taskClassesOf(snapshot, project), [
    { class_id: "class-1" },
    { class_id: "class-1" },
    { class_id: "class-3" },
    { class_id: null },
  ]);
  assert.deepEqual(
    counts.map((item) => [item.name, item.count]),
    [
      ["Tumor cell", 2],
      ["Lymphocyte", 0],
      ["Mitosis", 1],
    ],
  );
});

test("progress across the task's slides counts checked and signed off slides", () => {
  const statuses = [
    status({ experts: [checked()], signed_off_at: "2026-11-08T12:00:00Z" }),
    status({ experts: [checked()] }),
    status({}),
    undefined,
  ];
  assert.deepEqual(
    statuses.map((item) => slideStepOf(item, "me")),
    ["signed-off", "checked", "open", "open"],
  );
  assert.deepEqual(taskProgressOf(statuses, "me"), {
    total: 4,
    checked: 2,
    signedOff: 1,
    line: "2 of 4 slides checked, 1 signed off",
  });
  assert.equal(taskProgressOf([status({})], "me").line, "0 of 1 slides checked");
  assert.equal(nextSlideOf(["a", "b", "c", "d"], "b", statuses, "me"), "c");
  assert.equal(nextSlideOf(["a"], "a", [status({ experts: [checked()] })], "me"), null);
});

test("only an owner signs off, and only once every expert has checked", () => {
  const ready = status({ experts: [checked(), checked("anna")] });
  assert.equal(canSignOff(ready, true), true);
  assert.equal(canSignOff(ready, false), false);
  assert.equal(
    canSignOff(status({ experts: [checked(), { ...checked("anna"), checked_at: null }] }), true),
    false,
  );
  assert.equal(canSignOff({ ...ready, signed_off_at: "2026-11-08T12:00:00Z" }, true), false);
});

test("a task without the opened slide is not an annotate task for that slide", () => {
  const task = {
    id: "t",
    kind: "annotate",
    classes: snapshot,
    slides: [{ slide_id: "a", result_set_id: "rs1", reviewer_ids: [] }],
  } as unknown as ReviewTaskDetail;
  assert.equal(annotateTaskOf(task, "other", true), null);
  assert.equal(annotateTaskOf(task, "a", true)?.resultSetId, "rs1");
});

test("annotations wait for the task to settle so they load from the right layer", () => {
  assert.equal(layerKnownOf(undefined, false), true);
  assert.equal(layerKnownOf("t", false), false);
  assert.equal(layerKnownOf("t", true), true);
});
