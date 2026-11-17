import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type LiveSlideList,
  liveDecisionSplit,
  stepLiveSlide,
  timeLeftText,
  withNeighbours,
} from "../src/viewer/live-slides.ts";
import type { SlideAreaEntry } from "../src/viewer/slide-areas.ts";
import { threadTarget } from "../src/viewer/thread-target.ts";

const row = (id: string) => ({ id, label: id, case_id: null, status: "", result_sets: [] });
const list: LiveSlideList = {
  scope: "task",
  slides: [row("a"), row("b"), row("c")],
  position: 2,
  total: 3,
};

const areas: SlideAreaEntry[] = [
  { object: "T2", size: 10, bounds: { x: 100, y: 200, width: 300, height: 400 } },
];

test("stepLiveSlide steps to the neighbour on either side", () => {
  assert.equal(stepLiveSlide(list, "b", -1), "a");
  assert.equal(stepLiveSlide(list, "b", 1), "c");
});

test("stepLiveSlide stops at both ends and for an unknown slide", () => {
  assert.equal(stepLiveSlide(list, "a", -1), undefined);
  assert.equal(stepLiveSlide(list, "c", 1), undefined);
  assert.equal(stepLiveSlide(list, "z", 1), undefined);
});

test("stepLiveSlide prefers the neighbours the server named", () => {
  const named = withNeighbours(list, {
    position: 9,
    total: 12,
    previous: { id: "p" },
    next: null,
  });
  assert.equal(stepLiveSlide(named, "z", -1), "p");
  assert.equal(stepLiveSlide(named, "z", 1), undefined);
});

test("liveDecisionSplit counts each decision and leaves the rest open", () => {
  assert.deepEqual(
    liveDecisionSplit([{ value: "agree" }, { value: "agree" }, { value: "unsure" }], 5),
    { agree: 2, disagree: 0, unsure: 1, open: 2, decided: 3, total: 5 },
  );
});

test("liveDecisionSplit never reports fewer objects than decisions", () => {
  assert.equal(liveDecisionSplit([{ value: "disagree" }], 0).total, 1);
});

test("timeLeftText counts twenty minutes for each slide still to go", () => {
  assert.equal(timeLeftText(2, 3), "about 20 min");
  assert.equal(timeLeftText(1, 5), "about 1 h 20 min");
  assert.equal(timeLeftText(3, 3), "about 0 min");
});

test("threadTarget uses the area of the anchored object or of its parent", () => {
  assert.deepEqual(threadTarget({ kind: "object", object_id: "T2" }, areas), areas[0]?.bounds);
  assert.deepEqual(threadTarget({ kind: "object", object_id: "T2·C145" }, areas), areas[0]?.bounds);
});

test("threadTarget boxes a pin and a polygon from their geometry", () => {
  assert.deepEqual(
    threadTarget({ kind: "point", geometry: { type: "Point", coordinates: [1000, 2000] } }, areas),
    { x: 800, y: 1800, width: 400, height: 400 },
  );
  assert.deepEqual(
    threadTarget(
      {
        kind: "shape",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [10, 20],
              [110, 20],
              [110, 70],
            ],
          ],
        },
      },
      areas,
    ),
    { x: 10, y: 20, width: 100, height: 50 },
  );
});

test("threadTarget has no target without an area or geometry", () => {
  assert.equal(threadTarget({ kind: "roi", object_id: "R2⁺" }, areas), null);
});
