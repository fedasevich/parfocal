import assert from "node:assert/strict";
import { test } from "node:test";
import type { Target } from "@parfocal/api-client";
import { targetHref } from "../src/shell/notification-target.ts";

const origin = { route: "my-work" } as Target["origin"];

test("a task notice with a waiting slide opens the adjudication screen", () => {
  const target = {
    kind: "task",
    project_id: "p",
    task_id: "t1",
    slide_id: "s2",
    origin,
  } as Target;
  assert.equal(targetHref(target), "/tasks/t1/adjudicate");
});

test("a plain task notice still opens the guided review", () => {
  const target = { kind: "task", project_id: "p", task_id: "t1", origin } as Target;
  assert.equal(targetHref(target), "/tasks/t1/guided");
});
