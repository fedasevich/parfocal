import assert from "node:assert/strict";
import { test } from "node:test";
import { detailOf, kindIcons, kindTitles, titleOf } from "../src/shell/activity.ts";

test("a task notification without a written detail names its task and slide count", () => {
  const item = { payload: { task_name: "Round 2 review", slides: 4 } };
  assert.equal(detailOf(item), "Round 2 review · 4 slides");
  assert.equal(detailOf({ payload: { task_name: "Round 2 review" } }), "Round 2 review");
  assert.equal(detailOf({ payload: { detail: "Written", task_name: "x" } }), "Written");
  assert.equal(detailOf({ payload: {} }), undefined);
});

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
