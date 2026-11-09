import assert from "node:assert/strict";
import { test } from "node:test";
import {
  areaAround,
  checkQueueOf,
  currentOf,
  guideAction,
  guidedBindings,
  nextClassOf,
  type Queued,
  skippedState,
  startState,
} from "../src/annotations/guided-check.ts";

const cell = (number: number, score: number | null, check: Queued["check"] = "unchecked") => ({
  object: `C${number}`,
  number,
  score,
  check,
});

const first = [cell(1, 0.42), cell(2, 0.61), cell(3, 0.73), cell(4, 0.88), cell(5, 0.55)];

test("the queue is the unchecked objects, least sure first, unknown scores last", () => {
  const queue = checkQueueOf([...first, cell(6, null), cell(7, 0.1, "confirmed")], []);
  assert.deepEqual(queue, ["C1", "C5", "C2", "C3", "C4", "C6"]);
});

test("equal scores follow the object number", () => {
  assert.deepEqual(checkQueueOf([cell(9, 0.5), cell(3, 0.5)], []), ["C3", "C9"]);
});

test("a checked object leaves the queue and the next one becomes current", () => {
  const after = checkQueueOf([cell(1, 0.42, "confirmed"), ...first.slice(1)], []);
  assert.equal(currentOf(after, startState), "C5");
});

test("a skipped object goes to the end and the one after it is current", () => {
  const queue = checkQueueOf(first, []);
  const state = skippedState(queue, startState);
  const reordered = checkQueueOf(first, state.skipped);
  assert.deepEqual(reordered, ["C5", "C2", "C3", "C4", "C1"]);
  assert.equal(currentOf(reordered, state), "C5");
});

test("skipping the last object wraps to the first", () => {
  const state = skippedState(["C1", "C2"], { skipped: [], pinned: "C2" });
  assert.equal(state.pinned, "C1");
});

test("objects a running model adds join the queue without moving the current one", () => {
  const state = { skipped: [], pinned: "C5" };
  assert.equal(currentOf(checkQueueOf(first, []), state), "C5");
  const landed = [...first, cell(6, 0.05), cell(7, 0.5), cell(8, 0.99)];
  const grown = checkQueueOf(landed, []);
  assert.deepEqual(grown, ["C6", "C1", "C7", "C5", "C2", "C3", "C4", "C8"]);
  assert.equal(currentOf(grown, state), "C5");
});

test("when the current object is checked, a newly landed least sure object is next", () => {
  const landed = [cell(1, 0.42, "confirmed"), ...first.slice(1), cell(6, 0.05)];
  const grown = checkQueueOf(landed, []);
  assert.equal(currentOf(grown, { skipped: [], pinned: "C1" }), "C6");
});

test("an empty queue has no current object", () => {
  assert.equal(currentOf([], startState), null);
});

test("the next class cycles through the task's classes", () => {
  assert.equal(nextClassOf(["a", "b", "c"], "a"), "b");
  assert.equal(nextClassOf(["a", "b", "c"], "c"), "a");
  assert.equal(nextClassOf(["a", "b"], null), "a");
  assert.equal(nextClassOf([], "a"), null);
  assert.equal(nextClassOf(["a"], "a"), null);
});

test("the camera area is around the object and never smaller than the smallest view", () => {
  const area = areaAround({
    type: "Polygon",
    coordinates: [
      [
        [100, 100],
        [120, 100],
        [120, 130],
        [100, 100],
      ],
    ],
  });
  assert.ok(area);
  assert.equal(area.width, 320);
  assert.equal(area.x + area.width / 2, 110);
  assert.equal(area.y + area.height / 2, 115);
});

test("the guided keys are bound on annotate screens", () => {
  const actions = guidedBindings().map((binding) => binding.action);
  assert.ok(actions.includes(guideAction));
  assert.ok(actions.includes("gnext"));
});
