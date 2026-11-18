import assert from "node:assert/strict";
import { test } from "node:test";
import {
  choiceOfCorner,
  chosenPlacement,
  cornerOfChoice,
  cornerOfPoint,
  fitsCanvas,
  pinnedMinimap,
  placeMinimap,
  type ScreenRect,
  stepCorner,
} from "../src/screens/viewer-tools/minimap-placement.ts";

const canvas = { width: 1048, height: 856 };
const box = { width: 162, height: 190 };

test("a dropped minimap lands in the corner whose quadrant holds its centre", () => {
  assert.equal(cornerOfPoint(canvas, [100, 100]), "top-left");
  assert.equal(cornerOfPoint(canvas, [900, 100]), "top-right");
  assert.equal(cornerOfPoint(canvas, [100, 700]), "bottom-left");
  assert.equal(cornerOfPoint(canvas, [900, 700]), "bottom-right");
});

test("the saved corner word and the corner name convert both ways", () => {
  assert.equal(cornerOfChoice("auto"), null);
  for (const choice of ["br", "bl", "tr", "tl"] as const) {
    const corner = cornerOfChoice(choice);
    assert.ok(corner);
    assert.equal(choiceOfCorner(corner), choice);
  }
});

test("a pinned minimap sits 12 px inside the corner it was given", () => {
  assert.deepEqual(pinnedMinimap(canvas, box, "top-left"), {
    corner: "top-left",
    x: 12,
    y: 12,
    score: 0,
  });
  const bottomRight = pinnedMinimap(canvas, box);
  assert.equal(bottomRight.corner, "bottom-right");
  assert.equal(bottomRight.x, canvas.width - box.width - 12);
  assert.equal(bottomRight.y, canvas.height - box.height - 12);
});

test("the chosen corner outranks hot points and gives way only to a block", () => {
  const hot: [number, number, number][] = [[60, 60, 50]];
  const free = placeMinimap(canvas, box, hot, []);
  assert.equal(free.corner, "bottom-right");
  assert.equal(chosenPlacement(free, "top-left").corner, "top-left");
  assert.equal(chosenPlacement(free, null).corner, "bottom-right");
  const block: ScreenRect = [0, 0, 300, 300];
  const blocked = placeMinimap(canvas, box, [], [block]);
  assert.equal(chosenPlacement(blocked, "top-left").corner, "bottom-right");
  assert.equal(chosenPlacement(placeMinimap(canvas, box, [], []), "top-left").corner, "top-left");
});

test("the arrow keys step the minimap between corners", () => {
  assert.equal(stepCorner("bottom-right", "ArrowUp"), "top-right");
  assert.equal(stepCorner("top-right", "ArrowLeft"), "top-left");
  assert.equal(stepCorner("top-left", "ArrowDown"), "bottom-left");
  assert.equal(stepCorner("bottom-left", "ArrowRight"), "bottom-right");
  assert.equal(stepCorner("bottom-left", "Enter"), "bottom-left");
});

test("the minimap hides on a narrow canvas or when every corner is blocked", () => {
  assert.equal(fitsCanvas(canvas, placeMinimap(canvas, box, [], [])), true);
  const narrow = { width: 460, height: 856 };
  assert.equal(fitsCanvas(narrow, placeMinimap(narrow, box, [], [])), false);
  const everything: ScreenRect = [0, 0, canvas.width, canvas.height];
  assert.equal(fitsCanvas(canvas, placeMinimap(canvas, box, [], [everything])), false);
});
