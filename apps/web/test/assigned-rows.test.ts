import assert from "node:assert/strict";
import { test } from "node:test";
import type { AssignedTask, ReviewerProgress } from "@parfocal/api-client";
import {
  assignedLook,
  assignedNudgeMessage,
  behindmost,
  changeable,
} from "../src/screens/my-work/assigned-rows.ts";

const reviewer = (
  user_id: string,
  slides_submitted: number,
  slides_assigned = 12,
): ReviewerProgress => ({
  user_id,
  slides_submitted,
  slides_assigned,
  state:
    slides_submitted >= slides_assigned
      ? "submitted"
      : slides_submitted
        ? "in-review"
        : "not-started",
});

const task = (patch: Partial<AssignedTask>): AssignedTask => ({
  id: "task",
  code: "RT-14",
  name: "HoVer-NeXt vs pathologist",
  project: { id: "project", code: "PR-1", name: "Breast TILs" },
  due_on: "2026-10-23",
  status: "in-review",
  open_disagreements: 0,
  reviewers: [reviewer("simona", 4), reviewer("lenka", 9)],
  ...patch,
});

test("each status gets its tone and its one action", () => {
  const cases: [AssignedTask["status"], string, string | null][] = [
    ["disagreements", "warn", "resolve"],
    ["ready-to-sign-off", "ok", "sign-off"],
    ["signed-off", "ok", null],
    ["in-review", "accent", "nudge"],
    ["not-started", "neutral", "nudge"],
  ];
  for (const [status, tone, action] of cases) {
    const look = assignedLook(task({ status, open_disagreements: 7 }));
    assert.deepEqual([look.tone, look.action], [tone, action], status);
  }
});

test("nobody is nudged when every reviewer has submitted", () => {
  const all = task({ reviewers: [reviewer("simona", 12), reviewer("lenka", 12)] });
  assert.equal(behindmost(all), undefined);
  assert.equal(assignedLook(all).action, null);
});

test("the nudge goes to the reviewer with the most slides left", () => {
  assert.equal(behindmost(task({}))?.user_id, "simona");
  assert.equal(
    behindmost(task({ reviewers: [reviewer("simona", 4, 6), reviewer("lenka", 1)] }))?.user_id,
    "lenka",
  );
});

test("only a signed-off task has no more menu", () => {
  assert.equal(changeable(task({ status: "signed-off" })), false);
  for (const status of ["disagreements", "ready-to-sign-off", "in-review", "not-started"] as const)
    assert.equal(changeable(task({ status })), true, status);
});

test("the nudge text names the due day when there is one", () => {
  const simona = reviewer("simona", 4);
  assert.equal(
    assignedNudgeMessage("Simona Marková", task({}), simona),
    "Hi Simona, RT-14 is due Fri 23 Oct and has 8 slides left for you. Could you fit some in this week?",
  );
  assert.equal(
    assignedNudgeMessage("Simona Marková", task({ due_on: null }), simona),
    "Hi Simona, RT-14 has 8 slides left for you. Could you fit some in this week?",
  );
});
