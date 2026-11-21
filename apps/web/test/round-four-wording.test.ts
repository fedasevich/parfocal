import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPrompts } from "../src/aiseg/smart-select.ts";
import { smartStatusOf } from "../src/annotations/smart-status.ts";
import { slidesTimeLeft } from "../src/screens/review/slides-time-left.ts";
import { liveSlideList, timeLeftText } from "../src/viewer/live-slides.ts";
import { readOnlyCodeOf } from "../src/viewer/viewer-access.ts";

test("the last or only slide of a review counts its own minutes, never about 0 min left", () => {
  assert.equal(slidesTimeLeft(1, 1), "about 16 min left");
  assert.equal(slidesTimeLeft(12, 12), "about 16 min left");
  assert.equal(slidesTimeLeft(11, 12), "about 32 min left");
  assert.equal(slidesTimeLeft(8, 12), "about 1 h 20 min left");
  assert.equal(slidesTimeLeft(9, 12), "about 1 h 4 min left");
});

test("the viewer chip counts a case or project in label order and its last slide has no minutes", () => {
  const row = (id: string, label: string) => ({
    id,
    label,
    case_id: "c",
    status: "",
    result_sets: [],
  });
  const slides = [row("b", "Slide 2"), row("a", "Slide 1"), row("c", "Slide 10")];
  const inCase = liveSlideList({
    slideId: "a",
    slides,
    taskSlideIds: undefined,
    caseSlideIds: ["b", "a", "c"],
  });
  assert.deepEqual([inCase.position, inCase.total], [1, 3]);
  assert.deepEqual(
    inCase.slides.map((slide) => slide.label),
    ["Slide 1", "Slide 2", "Slide 10"],
  );
  const inTask = liveSlideList({
    slideId: "a",
    slides,
    taskSlideIds: ["b", "a"],
    caseSlideIds: undefined,
  });
  assert.equal(inTask.position, 2);
  assert.equal(timeLeftText(2, 2), null);
  assert.equal(timeLeftText(1, 2), "about 20 min");
});

test("the Smart select bar says when an outline was found", () => {
  const ring = Float32Array.of(0, 0, 1, 0, 1, 1);
  const live = { prompts: emptyPrompts, ring, confidence: 0.9 };
  const base = { kept: [], live: null, phase: "idle" as const, message: null };
  assert.equal(smartStatusOf(base), null);
  assert.equal(smartStatusOf({ ...base, phase: "thinking" }), "outlining");
  assert.equal(smartStatusOf({ ...base, phase: "ready", live }), "found");
  assert.equal(smartStatusOf({ ...base, phase: "failed", message: "No outline found" }), "message");
});

test("the banner of a task you are not assigned to uses its own notice, not a refusal", () => {
  assert.equal(
    readOnlyCodeOf({ kind: "read-only", reason: "not-assigned" }),
    "not-assigned-notice",
  );
  assert.equal(readOnlyCodeOf({ kind: "read-only", reason: "withdrawn" }), "task-withdrawn");
});
