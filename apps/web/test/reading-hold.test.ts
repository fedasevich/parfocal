import assert from "node:assert/strict";
import { test } from "node:test";
import type { InboxItem } from "@parfocal/api-client";
import { chimeUnlessHeld, type StatNotice } from "../src/shell/notification-gate.ts";
import { createReadingHold, isSlideRoute } from "../src/shell/reading-hold.ts";

const stat: StatNotice = { channel: "bell", sound: true };
const minute = 60_000;

const statItem = (id: string, created_at: string): InboxItem =>
  ({
    id,
    kind: "task-assigned",
    read: false,
    created_at,
    link: "/",
    payload: { priority: "stat" },
  }) as unknown as InboxItem;

test("nothing is pushed while a slide is open, then all arrive in order once it closes", () => {
  const hold = createReadingHold();
  const heard = new Set<string>();
  const arrived: InboxItem[] = [];
  hold.open(0);
  for (const [index, id] of ["c", "a", "b"].entries()) {
    arrived.push(statItem(id, `2026-11-08T10:0${index}:00Z`));
    assert.deepEqual(chimeUnlessHeld(arrived, heard, stat, hold.isHeld(index * minute, 15)), []);
  }
  hold.close();
  const released = chimeUnlessHeld(arrived, heard, stat, hold.isHeld(4 * minute, 15));
  assert.deepEqual(
    released.map((item) => item.id),
    ["c", "a", "b"],
  );
});

test("an open state older than the idle time is released", () => {
  const hold = createReadingHold();
  hold.open(0);
  assert.equal(hold.isHeld(14 * minute, 15), true);
  assert.equal(hold.isHeld(15 * minute, 15), false);
});

test("activity keeps the open state fresh and a closed slide holds nothing", () => {
  const hold = createReadingHold();
  hold.touch(0);
  assert.equal(hold.isHeld(1, 15), false);
  hold.open(0);
  hold.touch(10 * minute);
  assert.equal(hold.isHeld(20 * minute, 15), true);
  hold.close();
  assert.equal(hold.isHeld(20 * minute, 15), false);
});

test("only slide routes count as reading", () => {
  assert.equal(isSlideRoute("/projects/$projectId/slides/$slideId"), true);
  assert.equal(isSlideRoute("/projects/$projectId/slides/$slideId_/annotate"), true);
  assert.equal(isSlideRoute("/my-work"), false);
});
