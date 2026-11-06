import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResumeTarget } from "@parfocal/api-client";
import { continueTo, openInFullViewer } from "../src/screens/home/continue-to.ts";

const resume: ResumeTarget = {
  task_id: "task-1",
  task_code: "RT-14",
  task_name: "Round 2",
  project: { id: "project-1", code: "P07", name: "Sentinel node" },
  slide_id: "slide-1",
  slide_label: "A1",
  case_label: "S26-04812",
  position: 7,
  slides_assigned: 12,
  object_id: "T3",
  verdicts_on_slide: 2,
  due_on: null,
  blinded: false,
  mode: "guided",
  camera: null,
};

test("Continue opens guided review on the saved slide and object", () => {
  assert.equal(continueTo(resume), "/tasks/task-1/guided?slide=slide-1&object=T3");
});

test("Continue opens guided review at the saved view when one is stored", () => {
  const url = continueTo({ ...resume, camera: { x: 0.25, y: 0.5, z: 2 } });
  assert.equal(url, "/tasks/task-1/guided?slide=slide-1&object=T3&x=0.25&y=0.5&z=2");
});

test("a slide left in the viewer continues in the viewer with its camera", () => {
  const url = continueTo({ ...resume, mode: "viewer", camera: { x: 0.3, y: 0.4, z: 2 } });
  assert.equal(url, "/projects/project-1/slides/slide-1?task=task-1&object=T3&x=0.3&y=0.4&z=2");
});

test("with no object saved Continue names only the slide", () => {
  assert.equal(continueTo({ ...resume, object_id: null }), "/tasks/task-1/guided?slide=slide-1");
});

test("Open in the full viewer keeps the task and object but not the camera", () => {
  assert.equal(
    openInFullViewer({ ...resume, camera: { x: 0.3, y: 0.4, z: 2 } }),
    "/projects/project-1/slides/slide-1?task=task-1&object=T3",
  );
});
