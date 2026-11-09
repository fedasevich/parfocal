import assert from "node:assert/strict";
import { test } from "node:test";
import {
  areaAround,
  checkQueueOf,
  currentOf,
  guideAction,
  guidedAvailable,
  guidedBindings,
  guidedToggle,
  nextClassOf,
  type Queued,
  selectionAfterRowClick,
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

const slide = [cell(1, 0.9), cell(2, 0.2), cell(3, 0.5), cell(4, 0.7), cell(5, 0.3), cell(6, 0.6)];

test("a score scope keeps only the stored objects, in the stored order", () => {
  assert.deepEqual(checkQueueOf(slide, [], ["C5", "C2", "C3"]), ["C5", "C2", "C3"]);
});

test("a sample scope leaves the rest of the slide out of the queue", () => {
  assert.deepEqual(checkQueueOf(slide, [], ["C6", "C1"]), ["C6", "C1"]);
});

test("a region scope keeps objects the stored order lists and drops others", () => {
  assert.deepEqual(checkQueueOf(slide, [], ["C4", "C99", "C2"]), ["C4", "C2"]);
});

test("the by-position order is kept even where scores would sort differently", () => {
  const stored = ["C1", "C2", "C3", "C4", "C5", "C6"];
  assert.deepEqual(checkQueueOf(slide, [], stored), stored);
  assert.deepEqual(checkQueueOf(slide, []), ["C2", "C5", "C3", "C6", "C4", "C1"]);
});

test("the least sure order stored for the task is kept as stored", () => {
  assert.deepEqual(checkQueueOf(slide, [], ["C2", "C5", "C3"]), ["C2", "C5", "C3"]);
});

test("checked objects leave a stored queue and skipped ones go last", () => {
  const checked = slide.map((item) =>
    item.object === "C2" ? { ...item, check: "confirmed" as const } : item,
  );
  assert.deepEqual(checkQueueOf(checked, ["C5"], ["C5", "C2", "C3"]), ["C3", "C5"]);
});

test("no stored order falls back to the client sort", () => {
  const fallback = ["C2", "C5", "C3", "C6", "C4", "C1"];
  assert.deepEqual(checkQueueOf(slide, [], null), fallback);
  assert.deepEqual(checkQueueOf(slide, [], []), fallback);
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

test("the guided check is available only with shown AI objects on an unlocked slide", () => {
  assert.equal(guidedAvailable(true, 3, false), true);
  assert.equal(guidedAvailable(false, 3, false), false);
  assert.equal(guidedAvailable(true, 0, false), false);
  assert.equal(guidedAvailable(true, 3, true), false);
});

test("the guide key turns the mode on only when it can be shown and always turns it off", () => {
  assert.equal(guidedToggle(false, true), true);
  assert.equal(guidedToggle(false, false), false);
  assert.equal(guidedToggle(true, false), false);
  assert.equal(guidedToggle(true, true), false);
});

test("a list row click keeps the selection on the guided object", () => {
  assert.equal(selectionAfterRowClick(true, "C1", "C4"), "C1");
  assert.equal(selectionAfterRowClick(false, "C1", "C4"), "C4");
});
