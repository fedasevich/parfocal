import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dragCorner, dragFrame, dragOutline, finishDrag } from "../src/annotations/drag-shape.ts";
import { ellipseSegments } from "../src/annotations/shapes.ts";

const origin = { x: 10, y: 10 };

describe("rectangle and ellipse drags", () => {
  test("a rectangle drag gives the four corners", () => {
    const outline = finishDrag("rectangle", origin, { x: 40, y: 30 }, false, 1);
    assert.deepEqual(Array.from(outline ?? []), [10, 10, 40, 10, 40, 30, 10, 30]);
  });

  test("shift makes the sides equal in the drag direction", () => {
    assert.deepEqual(dragCorner(origin, { x: 40, y: 30 }, true), { x: 40, y: 40 });
    assert.deepEqual(dragCorner(origin, { x: -20, y: 15 }, true), { x: -20, y: 40 });
  });

  test("shift on a rectangle gives a square", () => {
    const outline =
      finishDrag("rectangle", origin, { x: 50, y: 20 }, true, 1) ?? new Float32Array();
    assert.deepEqual(Array.from(outline), [10, 10, 50, 10, 50, 50, 10, 50]);
  });

  test("shift on an ellipse gives a circle", () => {
    const outline = finishDrag("ellipse", origin, { x: 50, y: 20 }, true, 1) ?? new Float32Array();
    assert.equal(outline.length, ellipseSegments * 2);
    const radii = new Set<number>();
    for (let i = 0; i < outline.length; i += 2) {
      radii.add(Math.round(Math.hypot((outline[i] ?? 0) - 30, (outline[i + 1] ?? 0) - 30)));
    }
    assert.deepEqual([...radii], [20]);
  });

  test("an ellipse without shift keeps both radii", () => {
    const outline = dragOutline("ellipse", origin, { x: 50, y: 30 });
    assert.equal(outline[0], 50);
    assert.equal(outline[1], 20);
  });

  test("a tiny drag makes nothing", () => {
    assert.equal(finishDrag("rectangle", origin, { x: 12, y: 40 }, false, 1), null);
    assert.equal(finishDrag("ellipse", origin, { x: 11, y: 11 }, true, 1), null);
  });
});

describe("Alt draws from the centre", () => {
  const plain = { equalSides: false, fromCentre: false };

  test("without Alt the frame runs from the start to the corner", () => {
    assert.deepEqual(dragFrame({ x: 10, y: 10 }, { x: 50, y: 30 }, plain), {
      a: { x: 10, y: 10 },
      b: { x: 50, y: 30 },
    });
  });

  test("with Alt the start is the centre and the frame mirrors the corner", () => {
    const frame = dragFrame({ x: 10, y: 10 }, { x: 50, y: 30 }, { ...plain, fromCentre: true });
    assert.deepEqual(frame, { a: { x: -30, y: -10 }, b: { x: 50, y: 30 } });
  });

  test("Alt and Shift together give a square around the centre", () => {
    const frame = dragFrame(
      { x: 0, y: 0 },
      { x: 50, y: 20 },
      { equalSides: true, fromCentre: true },
    );
    assert.deepEqual(frame, { a: { x: -50, y: -50 }, b: { x: 50, y: 50 } });
  });

  test("a centred rectangle is finished with its mirrored corners", () => {
    const outline = finishDrag(
      "rectangle",
      { x: 100, y: 100 },
      { x: 150, y: 120 },
      { equalSides: false, fromCentre: true },
      1,
    );
    assert.deepEqual([...(outline ?? [])], [50, 80, 150, 80, 150, 120, 50, 120]);
  });

  test("the old boolean argument still means equal sides only", () => {
    const outline = finishDrag("rectangle", { x: 0, y: 0 }, { x: 40, y: 20 }, true, 1);
    assert.deepEqual([...(outline ?? [])], [0, 0, 40, 0, 40, 40, 0, 40]);
  });
});
