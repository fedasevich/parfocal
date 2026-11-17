import assert from "node:assert/strict";
import { test } from "node:test";
import { kindIcons, kindTitles, titleOf } from "../src/shell/activity.ts";

test("a notification without a written title is named by its kind", () => {
  assert.equal(titleOf({ kind: "task-assigned", payload: {} } as never), "New review task");
  assert.equal(
    titleOf({ kind: "mention", payload: { title: "Ana mentioned you" } } as never),
    "Ana mentioned you",
  );
  assert.equal(titleOf({ kind: "mention", payload: { title: "" } } as never), "You were mentioned");
});

test("every kind with an icon has a title", () => {
  for (const kind of Object.keys(kindIcons)) assert.ok(kindTitles[kind], kind);
});
