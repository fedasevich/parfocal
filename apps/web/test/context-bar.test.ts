import assert from "node:assert/strict";
import { test } from "node:test";
import { acceptLabel, contextBarOf, takesActiveClass } from "../src/annotations/context-bar.ts";
import { annotateRail } from "../src/screens/viewer-tools/rails.ts";
import { railToolOf, stageToolOf } from "../src/viewer/stage-tools.ts";

const state = { activeSlot: 1, activeName: "Tumor", counted: 23 };

const mockTable: Record<string, { label: string; hints: string[] }> = {
  select: {
    label: "Select",
    hints: [
      "Drag on empty tissue for a marquee",
      "⇧ adds to the selection",
      "Double-click an edge to add a point",
    ],
  },
  hand: { label: "Pan", hints: ["Drag to pan", "Space+drag pans in any tool"] },
  smart: {
    label: "Smart select",
    hints: [
      "PathoSAM · hover preview on",
      "Click a nucleus",
      "⇧click adds, right-click removes",
      "Enter accepts",
    ],
  },
  auto: { label: "Auto region", hints: [] },
  poly: {
    label: "Polygon",
    hints: ["Click to add points", "Enter or double-click closes", "⇧ snaps to 45°"],
  },
  free: { label: "Freehand", hints: ["Drag to draw", "Release to close the shape"] },
  rect: { label: "Rectangle", hints: ["Drag corner to corner", "⇧ makes a square"] },
  ellipse: { label: "Ellipse", hints: ["Drag corner to corner", "⇧ makes a circle"] },
  marker: { label: "Count marker", hints: ["Click to count", "Class 1 tumor · 23 counted"] },
  ruler: {
    label: "Ruler",
    hints: ["Drag to measure", "⇧ snaps to 45°", "Adds M1 to the Objects tab"],
  },
  arrow: { label: "Arrow", hints: ["Drag to point at something"] },
  text: { label: "Text", hints: ["Click and type", "Enter keeps, Esc drops"] },
  comment: { label: "Comment", hints: ["Click to pin a thread", "Enter posts"] },
  brush: { label: "Brush", hints: ["24 px", "⇧ erases", "Paints the tumor map"] },
};

const classTools = ["smart", "auto", "poly", "free", "rect", "ellipse", "marker", "brush"];

test("the context bar answers every rail tool with the label and hints of the mock table", () => {
  const railTools = annotateRail.flat().map((item) => item.tool);
  assert.deepEqual([...railTools].sort(), Object.keys(mockTable).sort());
  for (const railTool of railTools) {
    const model = contextBarOf(stageToolOf(railTool), state);
    const expected = mockTable[railTool];
    assert.equal(model.label, expected?.label, railTool);
    if (railTool !== "auto") assert.deepEqual(model.hints, expected?.hints, railTool);
  }
});

test("the class strip shows for the tools that make classed shapes and for no others", () => {
  for (const railTool of annotateRail.flat().map((item) => item.tool)) {
    const stage = stageToolOf(railTool);
    const expected = classTools.includes(railTool);
    assert.equal(contextBarOf(stage, state).classStrip, expected, railTool);
    assert.equal(takesActiveClass(stage), expected, railTool);
  }
});

test("stage tool names map back to the rail tools", () => {
  for (const railTool of annotateRail.flat().map((item) => item.tool)) {
    assert.equal(railToolOf(stageToolOf(railTool)), railTool);
  }
});

test("the count marker hint follows the active class and the total counted", () => {
  const model = contextBarOf("marker", { activeSlot: 2, activeName: "Immune", counted: 4 });
  assert.deepEqual(model.hints, ["Click to count", "Class 2 immune · 4 counted"]);
  const none = contextBarOf("marker", { activeSlot: null, activeName: null, counted: 0 });
  assert.deepEqual(none.hints, ["Click to count", "0 counted"]);
});

test("accept names the active class", () => {
  assert.equal(acceptLabel("Tumor"), "Accept as tumor");
  assert.equal(acceptLabel(null), "Accept");
});
