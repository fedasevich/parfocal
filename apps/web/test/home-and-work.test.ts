import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeViewFor } from "../src/fake-api/view-rules.ts";
import {
  andJoin,
  formatDue,
  formatLongDay,
  formatWeekday,
  greeting,
  relativeDay,
  relativeTime,
} from "../src/screens/format.ts";
import { tabOf } from "../src/screens/my-work/scenes.ts";

const now = new Date(2026, 9, 15, 14, 30);

test("the fake view follows the mock's persona switches", () => {
  assert.deepEqual(fakeViewFor("/", {}), { viewer: "LM", firstWeek: false });
  assert.deepEqual(fakeViewFor("/", { scene: "new" }), { viewer: "LM", firstWeek: true });
  assert.deepEqual(fakeViewFor("/my-work", { scene: "anna" }), { viewer: "AK", firstWeek: false });
  assert.deepEqual(fakeViewFor("/my-work", { tab: "assigned" }), {
    viewer: "DH",
    firstWeek: false,
  });
  assert.deepEqual(fakeViewFor("/my-work", { scene: "assigned" }), {
    viewer: "DH",
    firstWeek: false,
  });
  assert.deepEqual(fakeViewFor("/my-work", { tab: "all" }), { viewer: "LM", firstWeek: false });
  assert.deepEqual(fakeViewFor("/flow-map", { scene: "anna" }), { viewer: "LM", firstWeek: false });
  assert.deepEqual(fakeViewFor("/team", { scene: "anna" }), { viewer: "DH", firstWeek: false });
});

test("the as param picks any scenario person on any route and wins over the scene", () => {
  assert.deepEqual(fakeViewFor("/team", { as: "DH" }), { viewer: "DH", firstWeek: false });
  assert.deepEqual(fakeViewFor("/my-work", { as: "TB", scene: "anna" }), {
    viewer: "TB",
    firstWeek: false,
  });
  assert.deepEqual(fakeViewFor("/", { as: "nobody" }), { viewer: "LM", firstWeek: false });
});

test("a scene picks the My work tab only when the URL names none", () => {
  assert.equal(tabOf(undefined, undefined), "review");
  assert.equal(tabOf(undefined, "allpreview"), "all");
  assert.equal(tabOf(undefined, "assigned"), "assigned");
  assert.equal(tabOf("review", "allpreview"), "review");
});

test("dates read the way the mock writes them", () => {
  assert.equal(formatLongDay(now), "Thursday 15 October");
  assert.equal(formatDue("2026-10-23"), "Fri 23 Oct");
  assert.equal(formatWeekday("2026-10-23"), "Friday");
  assert.equal(greeting(now), "Good afternoon");
  assert.equal(greeting(new Date(2026, 9, 15, 8)), "Good morning");
  assert.equal(greeting(new Date(2026, 9, 15, 19)), "Good evening");
});

test("notification times count minutes, then hours, then show the time or the day", () => {
  assert.equal(relativeTime(new Date(2026, 9, 15, 14, 20), now), "10 min ago");
  assert.equal(relativeTime(new Date(2026, 9, 15, 13, 30), now), "1 h ago");
  assert.equal(relativeTime(new Date(2026, 9, 15, 9, 12), now), "09:12");
  assert.equal(relativeTime(new Date(2026, 9, 14, 17, 0), now), "yesterday");
  assert.equal(relativeTime(new Date(2026, 9, 9, 10, 0), now), "9 Oct");
  assert.equal(relativeDay(new Date(2026, 9, 13, 9), now), "2 days ago");
  assert.equal(relativeDay(new Date(2026, 9, 15, 8), now), "today");
});

test("lists of objects join with commas and a final and", () => {
  assert.equal(andJoin(["T4"]), "T4");
  assert.equal(andJoin(["T4", "T5", "T1·C145"]), "T4, T5 and T1·C145");
});
