import assert from "node:assert/strict";
import { test } from "node:test";
import { drawsContextBar, hintsSeen, markHintsSeen } from "../src/annotations/hints-once.ts";
import { liveSlideList, withNeighbours } from "../src/viewer/live-slides.ts";
import { movedWhileDown } from "../src/viewer/use-pan-hide.ts";

const row = (id: string, caseId: string | null = null) => ({
  id,
  label: `slide ${id}`,
  case_id: caseId,
  status: "ready",
  result_sets: [],
});

const slides = [row("a", "c1"), row("b", "c1"), row("c"), row("d")];

test("the slide list follows the task's order when a task is open", () => {
  const list = liveSlideList({
    slideId: "c",
    slides,
    taskSlideIds: ["d", "c", "missing"],
    caseSlideIds: ["a", "b"],
  });
  assert.equal(list.scope, "task");
  assert.deepEqual(
    list.slides.map((slide) => slide.id),
    ["d", "c", "missing"],
  );
  assert.equal(list.slides[2]?.label, "Slide 3");
  assert.deepEqual([list.position, list.total], [2, 3]);
  const counted = withNeighbours(list, { position: 7, total: 12 });
  assert.deepEqual([counted.position, counted.total], [7, 12]);
});

test("the slide list falls back to the case and then to the project", () => {
  const inCase = liveSlideList({
    slideId: "b",
    slides,
    taskSlideIds: undefined,
    caseSlideIds: ["a", "b"],
  });
  assert.deepEqual([inCase.scope, inCase.position, inCase.total], ["case", 2, 2]);
  assert.equal(withNeighbours(inCase, { position: 9, total: 40 }).total, 2);
  const loose = liveSlideList({ slideId: "d", slides, taskSlideIds: [], caseSlideIds: undefined });
  assert.deepEqual([loose.scope, loose.position, loose.total], ["project", 4, 4]);
  const missing = liveSlideList({
    slideId: "x",
    slides,
    taskSlideIds: undefined,
    caseSlideIds: undefined,
  });
  assert.equal(missing.position, 0);
});

test("the context bar draws only for options, proposals or a first look at the hints", () => {
  assert.equal(drawsContextBar({ classStrip: true, proposals: 0, hintsShown: false }), true);
  assert.equal(drawsContextBar({ classStrip: false, proposals: 3, hintsShown: false }), true);
  assert.equal(drawsContextBar({ classStrip: false, proposals: 0, hintsShown: true }), true);
  assert.equal(drawsContextBar({ classStrip: false, proposals: 0, hintsShown: false }), false);
});

test("a tool's hints are remembered as seen once", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  assert.equal(hintsSeen(storage).has("ruler"), false);
  markHintsSeen("ruler", storage);
  markHintsSeen("ruler", storage);
  assert.deepEqual([...hintsSeen(storage)], ["ruler"]);
  values.set("parfocal.tool-hints-seen", "not json");
  assert.equal(hintsSeen(storage).size, 0);
});

test("a pan is a camera move while the pointer is down", () => {
  assert.equal(movedWhileDown(null, { x: 1, y: 1 }), false);
  assert.equal(movedWhileDown({ x: 1, y: 1 }, { x: 1, y: 1 }), false);
  assert.equal(movedWhileDown({ x: 1, y: 1 }, { x: 1.2, y: 1 }), true);
});
