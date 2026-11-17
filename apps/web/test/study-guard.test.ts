import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultTasks,
  initialState,
  isBlocked,
  recordBlock,
  resolveGuard,
  type StudyContext,
  type StudyTask,
  startSession,
  summariseRound,
} from "../src/study/study-model.ts";

const context: StudyContext = {
  slides: [{ id: "s-44", label: "tumor_044", project: { id: "p-7" } }],
  resume: { projectId: "p-7", slideId: "s-a1", taskId: "rt-14" },
};

const guarded = (extra: Partial<StudyTask> = {}): StudyTask => ({
  id: "g",
  title: "G",
  instruction: "Stay",
  guard: {
    stayOn: ["^/projects/{taskProject}/slides/{taskSlide}(/|$)"],
    where: "Stay on the slide.",
  },
  ...extra,
});

test("a guard blocks destinations outside the task and lets the case screens pass", () => {
  const guard = resolveGuard(guarded(), "s1", context);
  assert.ok(guard);
  assert.equal(guard.where, "Stay on the slide.");
  assert.equal(isBlocked(guard, "/projects/p-7/slides/s-a1"), false);
  assert.equal(isBlocked(guard, "/projects/p-7/slides/s-a1/live"), false);
  assert.equal(isBlocked(guard, "/projects/p-7"), true);
  assert.equal(isBlocked(guard, "/my-work"), true);
});

test("a navigation that completes the task is never blocked", () => {
  const task = guarded({ check: { path: "/tasks/{task}/evaluation" } });
  const guard = resolveGuard(task, "s1", context);
  assert.ok(guard);
  assert.equal(isBlocked(guard, "/tasks/rt-14/evaluation"), false);
  assert.equal(isBlocked(guard, "/my-work"), true);
});

test("a task with no guard has none, and unresolved tokens drop the guard", () => {
  const { guard: _guard, ...unguarded } = guarded();
  assert.equal(resolveGuard(unguarded, "s1", context), undefined);
  assert.equal(resolveGuard(guarded(), "s1", { ...context, resume: null }), undefined);
});

test("blocked attempts are logged once and counted per task", () => {
  let state = startSession(initialState(), "P1", "s1", 0);
  state = recordBlock(state, "s1", { taskId: "t4", at: 5, to: "/my-work" });
  state = recordBlock(state, "s1", { taskId: "t4", at: 5, to: "/my-work" });
  state = recordBlock(state, "s1", { taskId: "t4", at: 9, to: "/" });
  state = recordBlock(state, "s1", { taskId: "t5", at: 11, to: "/" });
  const rows = summariseRound(state, 1);
  assert.equal(rows.find((row) => row.taskId === "t4")?.blocked, 2);
  assert.equal(rows.find((row) => row.taskId === "t5")?.blocked, 1);
  assert.equal(rows.find((row) => row.taskId === "t1")?.blocked, 0);
});

test("only the cell tasks carry a guard by default", () => {
  const guardedIds = defaultTasks.filter((task) => task.guard !== undefined).map((task) => task.id);
  assert.deepEqual(guardedIds, ["t4", "t5", "t6"]);
});
