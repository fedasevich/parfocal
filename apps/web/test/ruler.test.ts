import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addGroup, addShape, createDocument, updateGroup } from "../src/annotations/document.ts";
import {
  areaUnder,
  convexHull,
  distance,
  formatRulerLength,
  longestAxis,
  rulerMicrons,
  rulerPoints,
  segmentOfRuler,
  snapToAngle,
  snapToAreaAxis,
} from "../src/measure/ruler-maths.ts";

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

const across = (length: number) => ({ from: { x: 100, y: 100 }, to: { x: 100 + length, y: 100 } });

describe("ruler length in microns", () => {
  test("a horizontal drag is its pixel length times the microns per pixel", () => {
    close(rulerMicrons(across(1000), 0.25) ?? 0, 250);
  });

  test("the same drag measures differently on slides with different microns per pixel", () => {
    const drag = { from: { x: 0, y: 0 }, to: { x: 300, y: 400 } };
    close(rulerMicrons(drag, 0.25) ?? 0, 125);
    close(rulerMicrons(drag, 0.5) ?? 0, 250);
    close(rulerMicrons(drag, 0.2271) ?? 0, 113.55);
    close(rulerMicrons(drag, 1.0) ?? 0, 500);
  });

  test("a slide without a known spacing has no length in microns", () => {
    assert.equal(rulerMicrons(across(1000), null), null);
    assert.equal(rulerMicrons(across(1000), 0), null);
    assert.equal(rulerMicrons(across(1000), Number.NaN), null);
  });

  test("the label reads in micrometres below a millimetre and in millimetres above", () => {
    assert.equal(formatRulerLength(across(40), 0.25), "10.0 µm");
    assert.equal(formatRulerLength(across(1000), 0.25), "250 µm");
    assert.equal(formatRulerLength(across(4000), 0.25), "1.00 mm");
    assert.equal(formatRulerLength(across(8123), 0.25), "2.03 mm");
  });

  test("the label rounds across the unit boundaries without printing 1000 µm", () => {
    assert.equal(formatRulerLength(across(3999), 0.25), "1.00 mm");
    assert.equal(formatRulerLength(across(399), 0.25), "99.8 µm");
    assert.equal(formatRulerLength(across(3998), 0.25), "1.00 mm");
    assert.equal(formatRulerLength(across(3997), 0.25), "999 µm");
  });

  test("the label falls back to pixels when the spacing is unknown", () => {
    assert.equal(formatRulerLength(across(1234.4), null), "1234 px");
  });
});

describe("Shift snaps to 45 degrees", () => {
  const origin = { x: 10, y: 10 };

  test("a near horizontal drag lands exactly horizontal and keeps its length", () => {
    const snapped = snapToAngle(origin, { x: 210, y: 20 });
    close(snapped.y, 10);
    close(distance(origin, snapped), distance(origin, { x: 210, y: 20 }));
  });

  test("a near diagonal drag lands on the diagonal", () => {
    const snapped = snapToAngle(origin, { x: 110, y: 95 });
    close(snapped.x - origin.x, snapped.y - origin.y);
    close(distance(origin, snapped), distance(origin, { x: 110, y: 95 }));
  });

  test("every direction goes to the nearest multiple of 45 degrees", () => {
    for (let degrees = 0; degrees < 360; degrees += 7) {
      const radians = (degrees * Math.PI) / 180;
      const target = { x: 10 + Math.cos(radians) * 50, y: 10 + Math.sin(radians) * 50 };
      const snapped = snapToAngle(origin, target);
      const angle = (Math.atan2(snapped.y - 10, snapped.x - 10) * 180) / Math.PI;
      close(Math.abs(angle / 45 - Math.round(angle / 45)), 0, 1e-9);
      close(distance(origin, snapped), 50);
    }
  });

  test("a zero length drag stays where it is", () => {
    assert.deepEqual(snapToAngle(origin, origin), origin);
  });
});

describe("the long axis of an area", () => {
  test("the hull of a square with an inner point drops the inner point", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 2, y: 2 },
    ]);
    assert.equal(hull.length, 4);
  });

  test("a rectangle's long axis is its diagonal", () => {
    const axis = longestAxis([
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 30, y: 10 },
      { x: 0, y: 10 },
    ]);
    assert.ok(axis);
    close(distance(axis.from, axis.to), Math.hypot(30, 10));
  });

  test("a thin diagonal sliver measures along its length", () => {
    let doc = createDocument();
    ({ document: doc } = addShape(doc, {
      kind: "polygon",
      points: Float32Array.of(0, 0, 100, 90, 100, 100, 0, 10),
    }));
    const axis = snapToAreaAxis(doc, { x: 50, y: 50 });
    assert.ok(axis);
    close(distance(axis.from, axis.to), Math.hypot(100, 100));
  });

  test("an ellipse's long axis is its major axis, within the outline's sampling", () => {
    let doc = createDocument();
    ({ document: doc } = addShape(doc, {
      kind: "ellipse",
      points: Float32Array.of(0, 0, 200, 80),
    }));
    const axis = snapToAreaAxis(doc, { x: 100, y: 40 });
    assert.ok(axis);
    close(distance(axis.from, axis.to), 200, 0.01);
    close(Math.abs(axis.from.y - axis.to.y), 0, 0.01);
  });

  test("the area under the pointer is the smallest closed shape that contains it", () => {
    let doc = createDocument();
    ({ document: doc } = addShape(doc, {
      kind: "rectangle",
      points: Float32Array.of(0, 0, 500, 500),
    }));
    const inner = addShape(doc, { kind: "rectangle", points: Float32Array.of(100, 100, 300, 150) });
    doc = inner.document;
    assert.equal(areaUnder(doc, { x: 150, y: 120 })?.id, inner.shape.id);
    const axis = snapToAreaAxis(doc, { x: 150, y: 120 });
    assert.ok(axis);
    close(distance(axis.from, axis.to), Math.hypot(200, 50));
    assert.equal(areaUnder(doc, { x: 450, y: 450 })?.bounds[2], 500);
  });

  test("nothing under the pointer gives no axis", () => {
    let doc = createDocument();
    ({ document: doc } = addShape(doc, {
      kind: "rectangle",
      points: Float32Array.of(0, 0, 10, 10),
    }));
    assert.equal(snapToAreaAxis(doc, { x: 50, y: 50 }), null);
  });

  test("open shapes and rulers are not areas", () => {
    let doc = createDocument();
    ({ document: doc } = addShape(doc, { kind: "ruler", points: Float32Array.of(0, 0, 10, 10) }));
    ({ document: doc } = addShape(doc, { kind: "arrow", points: Float32Array.of(0, 0, 10, 10) }));
    assert.equal(areaUnder(doc, { x: 5, y: 5 }), null);
  });

  test("a hidden group's shapes are skipped", () => {
    let doc = createDocument();
    const group = addGroup(doc, "Regions");
    doc = group.document;
    ({ document: doc } = addShape(doc, {
      kind: "rectangle",
      points: Float32Array.of(0, 0, 100, 100),
      groupId: group.group.id,
    }));
    assert.ok(areaUnder(doc, { x: 50, y: 50 }));
    ({ document: doc } = updateGroup(doc, group.group.id, { hidden: true }));
    assert.equal(areaUnder(doc, { x: 50, y: 50 }), null);
  });

  test("a brush with a hole is not an area inside the hole", () => {
    let doc = createDocument();
    ({ document: doc } = addShape(doc, {
      kind: "brush",
      points: Float32Array.of(0, 0, 100, 0, 100, 100, 0, 100, 40, 40, 60, 40, 60, 60, 40, 60),
      ringStarts: Uint32Array.of(0, 4, 8),
    }));
    assert.ok(areaUnder(doc, { x: 10, y: 10 }));
    assert.equal(areaUnder(doc, { x: 50, y: 50 }), null);
  });
});

describe("a ruler stored in the annotation document", () => {
  test("its two ends survive the round trip and measure the same", () => {
    const segment = { from: { x: 12, y: 34 }, to: { x: 412, y: 334 } };
    const { shape } = addShape(createDocument(), { kind: "ruler", points: rulerPoints(segment) });
    const back = segmentOfRuler(shape);
    assert.deepEqual(back, segment);
    close(rulerMicrons(back, 0.25) ?? 0, 125);
  });
});
