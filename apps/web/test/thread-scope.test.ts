import assert from "node:assert/strict";
import { test } from "node:test";
import type { Thread } from "@parfocal/api-client";
import { threadScope } from "../src/annotations/thread-home.ts";

const thread = (taskId: string | null, resultSetId: string | null): Thread => ({
  id: "thread",
  project_id: "project",
  task_id: taskId,
  slide_id: "slide",
  title: "Which T1?",
  anchor: { kind: "object", object_id: "T1", result_set_id: resultSetId },
  created_by: "author",
  created_at: "2026-11-09T10:00:00Z",
  resolved_at: null,
  resolved_by: null,
  message_count: 1,
  last_message_at: "2026-11-09T10:00:00Z",
});

const names: Record<string, string> = { first: "HoVer-NeXt", second: "StarDist v2" };
const setName = (id: string) => names[id];

test("a taskless object thread names the result set its anchor keeps", () => {
  assert.equal(threadScope(thread(null, "second"), undefined, setName), "Slide · StarDist v2");
  assert.equal(threadScope(thread(null, "first"), undefined, setName), "Slide · HoVer-NeXt");
});

test("a taskless thread with no or an unknown result set reads Slide", () => {
  assert.equal(threadScope(thread(null, null), undefined, setName), "Slide");
  assert.equal(threadScope(thread(null, "gone"), undefined, setName), "Slide");
  assert.equal(threadScope(thread(null, "second"), undefined), "Slide");
});

test("a task thread keeps the task name", () => {
  assert.equal(threadScope(thread("task", "first"), "Blinding task", setName), "Blinding task");
  assert.equal(threadScope(thread("task", "first"), undefined, setName), "Task");
});
