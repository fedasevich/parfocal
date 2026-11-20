import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignSlides,
  gridOf,
  layoutOptions,
  panesOf,
} from "../src/screens/viewer-tools/compare-layout.ts";
import { pickSlide, slidesToCompare } from "../src/screens/viewer-tools/pane-slides.ts";

test("compare offers the slide's case, or every project slide when it has no case", () => {
  const slides = [
    { id: "a1", case: { label: "A" } },
    { id: "a2", case: { label: "A" } },
    { id: "b1", case: { label: "B" } },
    { id: "loose", case: null },
  ];
  assert.deepEqual(
    slidesToCompare(slides, "a1").map((slide) => slide.id),
    ["a1", "a2"],
  );
  assert.deepEqual(
    slidesToCompare(slides, "loose").map((slide) => slide.id),
    ["a1", "a2", "b1", "loose"],
  );
});

test("the layouts show one, two, two and four panes", () => {
  assert.deepEqual(
    layoutOptions.map((option) => panesOf(option.value).length),
    [1, 2, 2, 4],
  );
  assert.deepEqual(panesOf("four"), ["left", "right", "bottomLeft", "bottomRight"]);
});

test("panes sit side by side, stacked and in a grid of four", () => {
  assert.match(gridOf("side"), /grid-cols-2/);
  assert.match(gridOf("stacked"), /grid-rows-2/);
  assert.match(gridOf("four"), /grid-cols-2/);
  assert.match(gridOf("four"), /grid-rows-2/);
});

test("the extra panes get slides the first two do not show", () => {
  const slides = assignSlides(["a", "b", "c", "d"], {}, { left: "a", right: "b" });
  assert.deepEqual(slides, { left: "a", right: "b", bottomLeft: "c", bottomRight: "d" });
});

test("a case with fewer than four slides repeats some", () => {
  const slides = assignSlides(["a", "b"], {}, { left: "a", right: "b" });
  assert.ok(slides.bottomLeft !== undefined);
  assert.ok(slides.bottomRight !== undefined);
});

test("picking a slide that another visible pane shows swaps the two", () => {
  const current = { left: "a", right: "b", bottomLeft: "c", bottomRight: "d" };
  assert.deepEqual(pickSlide(current, "left", "d", panesOf("four")), {
    left: "d",
    right: "b",
    bottomLeft: "c",
    bottomRight: "a",
  });
});

test("picking a slide shown only on a hidden pane does not swap", () => {
  const current = { left: "a", right: "b", bottomLeft: "c", bottomRight: "d" };
  assert.deepEqual(pickSlide(current, "left", "d", panesOf("side")), { ...current, left: "d" });
});
