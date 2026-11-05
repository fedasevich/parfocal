import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addShape, createDocument } from "../src/annotations/document.ts";
import {
  canRemoveVertices,
  midpointsOf,
  moveVertices,
  removeVertices,
} from "../src/annotations/reshape.ts";
import type { Shape } from "../src/annotations/shapes.ts";

function shapeOf(kind: "polygon" | "ruler" | "rectangle" | "point", points: number[]): Shape {
  return addShape(createDocument(), { kind, points: Float32Array.from(points) }).shape;
}

const square = () => shapeOf("polygon", [0, 0, 10, 0, 10, 10, 0, 10]);

describe("vertex groups", () => {
  test("midpoints sit halfway along every edge of a closed shape", () => {
    assert.deepEqual(
      midpointsOf(square()).map((m) => [m.at.x, m.at.y]),
      [
        [5, 0],
        [10, 5],
        [5, 10],
        [0, 5],
      ],
    );
  });

  test("open and corner shapes offer no midpoints", () => {
    assert.deepEqual(midpointsOf(shapeOf("ruler", [0, 0, 10, 10])), []);
    assert.deepEqual(midpointsOf(shapeOf("rectangle", [0, 0, 10, 10])), []);
  });

  test("moving a set of vertices shifts only those and ignores unknown ids", () => {
    const moved = moveVertices(square(), [1, 2, 2, 9], 3, -1);
    assert.deepEqual([...moved.points], [0, 0, 13, -1, 13, 9, 0, 10]);
  });

  test("removing vertices keeps the order of the rest", () => {
    const five = shapeOf("polygon", [0, 0, 10, 0, 10, 10, 5, 15, 0, 10]);
    assert.deepEqual([...(removeVertices(five, [3, 1])?.points ?? [])], [0, 0, 10, 10, 0, 10]);
  });

  test("removal refuses to go below the kind's minimum", () => {
    const five = shapeOf("polygon", [0, 0, 10, 0, 10, 10, 5, 15, 0, 10]);
    assert.equal(canRemoveVertices(five, [0, 1, 2]), false);
    assert.equal(removeVertices(five, [0, 1, 2]), null);
    assert.equal(canRemoveVertices(square(), [0]), true);
    assert.equal(canRemoveVertices(square(), [0, 1]), false);
    assert.equal(canRemoveVertices(shapeOf("ruler", [0, 0, 10, 10]), [0]), false);
    assert.equal(canRemoveVertices(shapeOf("point", [0, 0]), [0]), false);
    assert.equal(canRemoveVertices(square(), []), false);
  });
});
