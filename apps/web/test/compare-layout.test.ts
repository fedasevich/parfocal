import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assignSlides,
  gridOf,
  layoutOptions,
  panesOf,
  pickSlide,
} from "../src/screens/viewer-tools/compare-layout.ts";

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
  assert.deepEqual(pickSlide(current, panesOf("four"), "left", "d"), {
    left: "d",
    right: "b",
    bottomLeft: "c",
    bottomRight: "a",
  });
});

test("picking a slide shown only on a hidden pane does not swap", () => {
  const current = { left: "a", right: "b", bottomLeft: "c", bottomRight: "d" };
  assert.deepEqual(pickSlide(current, panesOf("side"), "left", "d"), { ...current, left: "d" });
});
