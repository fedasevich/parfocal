import assert from "node:assert/strict";
import { test } from "node:test";
import type { MyTask, ResumeTarget } from "@parfocal/api-client";
import {
  activeTasks,
  continuePath,
  continuesHero,
  heroPath,
  reviewRow,
} from "../src/screens/my-work/to-review-rows.ts";

const task = (overrides: Partial<MyTask>): MyTask => ({
  id: "task-1",
  code: "RT-1",
  name: "Round 1 · Fake model",
  project: { id: "project-1", code: "P01", name: "Fake project" },
  scope: "random-cells",
  due_on: "2026-10-23",
  blinded: false,
  start_mode: "guided",
  slides_submitted: 0,
  slides_assigned: 12,
  verdicts: 0,
  status: "not-started",
  next_slide_id: "slide-1",
  created_by_user_id: "user-owner",
  ...overrides,
});

const resume = {
  task_id: "task-2",
  slide_id: "slide-8",
  object_id: "T1·C044",
  position: 7,
  slides_assigned: 12,
} as ResumeTarget;

const inProgress = task({
  id: "task-2",
  name: "Round 2 · Fake model",
  status: "in-review",
  slides_submitted: 7,
  blinded: true,
});
const fresh = task({ id: "task-3", scope: "all-regions", due_on: null });
const finished = task({ id: "task-4", status: "submitted", slides_submitted: 12 });

test("a task in progress shows its project, scope, due date, blinding and progress, and continues at the next object", () => {
  const row = reviewRow(inProgress, "Daniel Hruška", resume);
  assert.equal(row?.title, "Round 2 · Fake model");
  assert.equal(row?.sub, "Fake project · A random sample of cells · due Fri 23 Oct");
  assert.deepEqual(row?.progress, { value: 58, label: "7 of 12 slides" });
  assert.deepEqual(row?.tags, [
    { label: "Blind", tone: "neutral" },
    { label: "In progress", tone: "accent" },
  ]);
  assert.deepEqual(row?.action, {
    label: "Continue",
    primary: false,
    path: "/tasks/task-2/guided?slide=slide-8&object=T1%C2%B7C044",
  });
});

test("a new task says who sent it and starts at its first slide", () => {
  const row = reviewRow(fresh, "Daniel Hruška", resume);
  assert.equal(row?.sub, "Fake project · Tumor regions: all");
  assert.deepEqual(row?.tags, [{ label: "New from Daniel Hruška", tone: "warn" }]);
  assert.deepEqual(row?.action, {
    label: "Start",
    primary: true,
    path: "/tasks/task-3/guided?slide=slide-1",
  });
  assert.deepEqual(reviewRow(fresh, undefined, null)?.tags, [
    { label: "New from the researcher", tone: "warn" },
  ]);
});

test("a finished task leaves the To review list", () => {
  assert.equal(reviewRow(finished, "Daniel Hruška", resume), undefined);
  assert.deepEqual(
    activeTasks([inProgress, fresh, finished]).map((item) => item.id),
    ["task-2", "task-3"],
  );
});

test("Enter with nothing selected continues the task in progress in one action", () => {
  const active = [fresh, inProgress];
  assert.equal(heroPath(active, resume), continuePath(inProgress, resume));
  assert.equal(heroPath([fresh], resume), undefined);
  assert.equal(heroPath(active, null), undefined);
  assert.equal(continuesHero({ key: "Enter" }, undefined), true);
  assert.equal(continuesHero({ key: "Enter" }, "task-3"), false);
  assert.equal(continuesHero({ key: "Enter", metaKey: true }, undefined), false);
  assert.equal(continuesHero({ key: "j" }, undefined), false);
});
