import assert from "node:assert/strict";
import { test } from "node:test";
import { drawsContextBar } from "../src/annotations/hints-once.ts";
import { liveSlideGroups, liveSlideList, withNeighbours } from "../src/viewer/live-slides.ts";
import { movedWhileDown, slidOnly } from "../src/viewer/use-pan-hide.ts";

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

test("a pan is a camera move while the pointer is down", () => {
  assert.equal(movedWhileDown(null, { x: 1, y: 1 }), false);
  assert.equal(movedWhileDown({ x: 1, y: 1 }, { x: 1, y: 1 }), false);
  assert.equal(movedWhileDown({ x: 1, y: 1 }, { x: 1.2, y: 1 }), true);
});

test("a camera change that keeps the zoom is a slide and a zoom is not", () => {
  assert.equal(slidOnly({ x: 0, y: 0, zoom: 1 }, { x: 5, y: 0, zoom: 1 }), true);
  assert.equal(slidOnly({ x: 0, y: 0, zoom: 1 }, { x: 5, y: 0, zoom: 1.2 }), false);
  assert.equal(slidOnly({ x: 3, y: 3, zoom: 1 }, { x: 3, y: 3, zoom: 1 }), false);
});

test("the slides popover groups the case's slides and the task's loose slides", () => {
  const known = [
    { ...row("a", "c1"), result_sets: [{ name: "old" }] },
    {
      ...row("b", "c1"),
      result_sets: [{ name: "cam" }],
      reviews: [{ task_id: "t", state: "submitted" }],
    },
    { ...row("p", "c1"), status: "ai-running" },
    { ...row("c"), result_sets: [{ name: "sam" }] },
    row("d"),
    row("other", "c2"),
  ];
  const taskSlideIds = ["a", "b", "c", "d", "other"];
  const groups = liveSlideGroups({
    slideId: "a",
    list: liveSlideList({ slideId: "a", slides: known, taskSlideIds, caseSlideIds: ["a", "b"] }),
    slides: known,
    caseSlides: [
      { id: "a", label: "A1", stain: "H&E" },
      { id: "b", label: "A2", stain: "H&E" },
      { id: "p", label: "A3", stain: "CK" },
    ],
    task: { id: "t", slideIds: taskSlideIds },
    currentSetNames: ["cam", "sam"],
  });
  assert.deepEqual(
    groups.caseRows.map((item) => [item.name, item.sub, item.resultSets, item.status.label]),
    [
      ["A1 · H&E", "cam · sam", 2, "In review"],
      ["A2 · H&E", "cam", 1, "Submitted"],
      ["A3 · CK", undefined, 0, "Processing"],
    ],
  );
  assert.deepEqual(
    groups.caseRows.map((item) => [item.current, item.building]),
    [
      [true, false],
      [false, false],
      [false, true],
    ],
  );
  assert.deepEqual(
    groups.looseRows.map((item) => [item.id, item.sub, item.status.label]),
    [
      ["c", "sam, no case attached", "To review"],
      ["d", "No case attached", "To review"],
    ],
  );
});

test("a slide with no case lists its scope in one group, with the slide's own state", () => {
  const list = liveSlideList({
    slideId: "c",
    slides,
    taskSlideIds: undefined,
    caseSlideIds: undefined,
  });
  const groups = liveSlideGroups({
    slideId: "c",
    list,
    slides,
    caseSlides: undefined,
    task: undefined,
  });
  assert.deepEqual(
    groups.caseRows.map((item) => [item.id, item.status.label]),
    [
      ["a", "Ready"],
      ["b", "Ready"],
      ["c", "Open"],
      ["d", "Ready"],
    ],
  );
  assert.deepEqual(groups.looseRows, []);
});
