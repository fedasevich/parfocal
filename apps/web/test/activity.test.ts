import assert from "node:assert/strict";
import { test } from "node:test";
import type { InboxItem } from "@parfocal/api-client";
import {
  filteredActivity,
  isNotificationsQuery,
  newestFirst,
  unreadIn,
} from "../src/shell/activity.ts";
import { isWorklistQuery } from "../src/worklist-live/worklist-events.ts";

const item = (id: string, kind: string, createdAt: string, read = false) =>
  ({ id, kind, created_at: createdAt, read, payload: {} }) as unknown as InboxItem;

const seeded = [
  item("a", "mention", "2026-11-14T08:00:00Z"),
  item("b", "reply", "2026-11-14T09:00:00Z", true),
  item("c", "model-run-finished", "2026-11-14T10:00:00Z"),
  item("d", "upload-done", "2026-11-14T07:00:00Z"),
  item("e", "task-signed-off", "2026-11-14T11:00:00Z"),
  item("f", "task-assigned", "2026-11-13T11:00:00Z"),
];

test("everything keeps every seeded event", () => {
  assert.equal(filteredActivity(seeded, "all").length, 6);
});

test("mentions keeps mentions and replies only", () => {
  assert.deepEqual(
    filteredActivity(seeded, "mentions").map((entry) => entry.id),
    ["a", "b"],
  );
});

test("jobs keeps model runs and imports only", () => {
  assert.deepEqual(
    filteredActivity(seeded, "jobs").map((entry) => entry.id),
    ["c", "d"],
  );
});

test("unread counts follow the filter", () => {
  assert.equal(unreadIn(seeded, "all"), 5);
  assert.equal(unreadIn(seeded, "mentions"), 1);
  assert.equal(unreadIn(seeded, "jobs"), 2);
});

test("activity lists the newest event first", () => {
  assert.deepEqual(
    newestFirst(seeded).map((entry) => entry.id),
    ["e", "c", "b", "a", "d", "f"],
  );
});

test("a new event shows up under its filter when the list refreshes", () => {
  const arrived = [...seeded, item("g", "mention", "2026-11-14T12:00:00Z")];
  assert.equal(filteredActivity(arrived, "mentions").length, 3);
  assert.equal(newestFirst(filteredActivity(arrived, "mentions"))[0]?.id, "g");
});

test("a worklist change refreshes every notifications query", () => {
  assert.equal(isNotificationsQuery(["/api/me/notifications"]), true);
  assert.equal(isNotificationsQuery(["/api/me/notifications/counts"]), true);
  assert.equal(isNotificationsQuery(["/api/me/home"]), false);
  assert.equal(isWorklistQuery(["/api/me/notifications"]), true);
  assert.equal(isWorklistQuery(["/api/me/notifications/counts"]), true);
  assert.equal(isWorklistQuery(["/api/me/home"]), true);
  assert.equal(isWorklistQuery(["/api/projects"]), false);
});
