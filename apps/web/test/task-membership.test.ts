import assert from "node:assert/strict";
import { test } from "node:test";
import { slideOutsideTask } from "../src/viewer/task-membership.ts";

const task = { slides: [{ slide_id: "a" }, { slide_id: "b" }] };

test("a slide listed in the task is inside it", () => {
  assert.equal(slideOutsideTask(task, "b"), false);
});

test("a slide not listed in the task is outside it for any task kind", () => {
  assert.equal(slideOutsideTask(task, "c"), true);
});

test("nothing is outside a task that has not loaded", () => {
  assert.equal(slideOutsideTask(undefined, "c"), false);
});
