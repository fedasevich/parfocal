import assert from "node:assert/strict";
import { test } from "node:test";
import type { InboxItem, Preference } from "@parfocal/api-client";
import { shownInBell, statToChime } from "../src/shell/notification-gate.ts";

const item = (
  id: string,
  kind: InboxItem["kind"],
  payload: InboxItem["payload"] = {},
  read = false,
) => ({ id, kind, payload, read }) as InboxItem;

const preference = (kind: Preference["kind"], inApp: boolean, mandatory = false): Preference => ({
  kind,
  in_app: inApp,
  email: false,
  realtime: false,
  mandatory,
});

const stat = { channel: "bell", sound: true } as const;

test("a quiet kind stays out of the bell and the others stay in", () => {
  const preferences = [preference("reply", false), preference("mention", true)];
  assert.equal(shownInBell(item("a", "reply"), preferences, stat), false);
  assert.equal(shownInBell(item("b", "mention"), preferences, stat), true);
  assert.equal(shownInBell(item("c", "model-run-finished"), preferences, stat), true);
});

test("a mandatory kind cannot be silenced", () => {
  const preferences = [preference("emergency-access", false, true)];
  assert.equal(shownInBell(item("a", "emergency-access"), preferences, stat), true);
});

test("a finished model run follows its own preference", () => {
  const preferences = [preference("model-run-finished", false)];
  assert.equal(shownInBell(item("a", "model-run-finished"), preferences, stat), false);
});

test("a STAT task follows the STAT choice, not the task preference", () => {
  const urgent = item("a", "task-assigned", { priority: "stat" });
  const preferences = [preference("task-assigned", false)];
  assert.equal(shownInBell(urgent, preferences, stat), true);
  assert.equal(shownInBell(urgent, [], { channel: "quiet", sound: true }), false);
  assert.equal(shownInBell(item("b", "task-assigned"), preferences, stat), false);
});

test("the STAT chime plays once for a new unread STAT task and only when sound is on", () => {
  const urgent = item("a", "task-assigned", { priority: "stat" });
  const plain = item("b", "task-assigned");
  assert.deepEqual(statToChime([urgent, plain], new Set(), stat), [urgent]);
  assert.deepEqual(statToChime([urgent], new Set(["a"]), stat), []);
  assert.deepEqual(statToChime([urgent], new Set(), { channel: "bell", sound: false }), []);
  assert.deepEqual(statToChime([urgent], new Set(), { channel: "quiet", sound: true }), []);
  assert.deepEqual(statToChime([{ ...urgent, read: true }], new Set(), stat), []);
});
