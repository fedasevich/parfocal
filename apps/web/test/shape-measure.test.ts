import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { NewShape } from "../src/annotations/document.ts";
import { addShape, createDocument } from "../src/annotations/document.ts";
import { formatArea, formatPerimeter, measureShape } from "../src/measure/shape-measure.ts";

const close = (actual: number | null | undefined, expected: number, tolerance = 1e-6) =>
  assert.ok(
    actual !== null && actual !== undefined && Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

function shapeOf(input: NewShape) {
  const { shape } = addShape(createDocument(), input);
  return shape;
}

describe("area and perimeter of closed shapes", () => {
  test("a rectangle in millimetres", () => {
    const measure = measureShape(
      shapeOf({ kind: "rectangle", points: Float32Array.of(0, 0, 4000, 2000) }),
      0.5,
    );
    assert.ok(measure);
    close(measure.areaSquarePixels, 8_000_000);
    close(measure.areaSquareMicrons, 2_000_000);
    close(measure.perimeterMicrons, 6000);
    assert.equal(formatArea(measure), "2.00 mm²");
    assert.equal(formatPerimeter(measure), "6.00 mm");
  });

  test("a small rectangle reads in microns", () => {
    const measure = measureShape(
      shapeOf({ kind: "rectangle", points: Float32Array.of(10, 10, 110, 60) }),
      0.25,
    );
    assert.ok(measure);
    close(measure.areaSquareMicrons, 312.5);
    close(measure.perimeterMicrons, 75);
    assert.equal(formatArea(measure), "313 µm²");
    assert.equal(formatPerimeter(measure), "75.0 µm");
  });

  test("a polygon uses the shoelace area whatever its winding", () => {
    const triangle = Float32Array.of(0, 0, 300, 0, 0, 400);
    const reversed = Float32Array.of(0, 400, 300, 0, 0, 0);
    for (const points of [triangle, reversed]) {
      const measure = measureShape(shapeOf({ kind: "polygon", points }), 1);
      assert.ok(measure);
      close(measure.areaSquareMicrons, 60_000);
      close(measure.perimeterMicrons, 1200);
    }
  });

  test("a concave polygon", () => {
    const measure = measureShape(
      shapeOf({
        kind: "polygon",
        points: Float32Array.of(0, 0, 100, 0, 100, 100, 50, 50, 0, 100),
      }),
      1,
    );
    assert.ok(measure);
    close(measure.areaSquareMicrons, 7500);
  });

  test("a circle matches pi r squared and 2 pi r", () => {
    const measure = measureShape(
      shapeOf({ kind: "ellipse", points: Float32Array.of(0, 0, 200, 200) }),
      1,
    );
    assert.ok(measure);
    close(measure.areaSquareMicrons, Math.PI * 100 * 100);
    close(measure.perimeterMicrons, 2 * Math.PI * 100);
  });

  test("an ellipse matches the analytic area and perimeter", () => {
    const measure = measureShape(
      shapeOf({ kind: "ellipse", points: Float32Array.of(0, 0, 200, 80) }),
      0.5,
    );
    assert.ok(measure);
    close(measure.areaSquareMicrons, Math.PI * 100 * 40 * 0.25);
    close(measure.perimeterMicrons, 230.13, 0.01);
  });

  test("a shape with a hole subtracts the hole and adds both perimeters", () => {
    const outer = [0, 0, 100, 0, 100, 100, 0, 100];
    const hole = [25, 25, 75, 25, 75, 75, 25, 75];
    const measure = measureShape(
      shapeOf({
        kind: "brush",
        points: Float32Array.from([...outer, ...hole]),
        ringStarts: Uint32Array.of(0, 4, 8),
      }),
      2,
    );
    assert.ok(measure);
    close(measure.areaSquareMicrons, (10_000 - 2500) * 4);
    close(measure.perimeterMicrons, (400 + 200) * 2);
  });

  test("two separate islands add up", () => {
    const measure = measureShape(
      shapeOf({
        kind: "brush",
        points: Float32Array.of(0, 0, 10, 0, 10, 10, 0, 10, 100, 100, 120, 100, 120, 120, 100, 120),
        ringStarts: Uint32Array.of(0, 4, 8),
      }),
      1,
    );
    assert.ok(measure);
    close(measure.areaSquareMicrons, 500);
  });

  test("a slide without microns per pixel measures in pixels only", () => {
    const shape = shapeOf({ kind: "rectangle", points: Float32Array.of(0, 0, 30, 20) });
    for (const mpp of [null, 0]) {
      const measure = measureShape(shape, mpp);
      assert.ok(measure);
      assert.equal(measure.areaSquareMicrons, null);
      assert.equal(measure.perimeterMicrons, null);
      assert.equal(formatArea(measure), "600 px²");
      assert.equal(formatPerimeter(measure), "100 px");
    }
  });

  test("open shapes have no area", () => {
    assert.equal(
      measureShape(shapeOf({ kind: "ruler", points: Float32Array.of(0, 0, 10, 10) }), 1),
      null,
    );
  });
});
