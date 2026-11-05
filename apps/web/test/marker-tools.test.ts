import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { type Camera, screenToSlide, slideToScreen } from "@parfocal/viewer-engine";
import {
  countByClass,
  deleteMarker,
  dropMarker,
  markerHitScreenPixels,
  markerNear,
  markerPoint,
  markersOf,
} from "../src/annotations/count-markers.ts";
import { createDocument } from "../src/annotations/document.ts";
import { addArrow, addText, arrowEndsOf, arrowsOf, textsOf } from "../src/annotations/marks.ts";
import { movePin, pinPoint, placePin } from "../src/annotations/pins.ts";
import { formatRulerLength, rulerMicrons, snapToAngle } from "../src/measure/ruler-maths.ts";

const close = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );

const stage = { left: 40, top: 120, width: 1000, height: 700 };

const zooms = [-3, -1.5, -0.0439, 0, 0.75, 2, 4.5, 6];

const cameras: Camera[] = zooms.flatMap((zoom) => [
  { x: 512, y: 384, zoom },
  { x: 12345.5, y: 987.25, zoom },
  { x: 0, y: 0, zoom },
]);

describe("a dropped point lands under the pointer at every zoom and camera", () => {
  for (const camera of cameras) {
    test(`zoom ${camera.zoom} at camera ${camera.x},${camera.y}`, () => {
      for (const [clientX, clientY] of [
        [41, 121],
        [540, 470],
        [1039, 819],
        [300.5, 333.25],
      ]) {
        const point = screenToSlide(camera, stage, clientX ?? 0, clientY ?? 0);
        const back = slideToScreen(camera, stage, point);
        close(back.x, clientX ?? 0, 1e-6);
        close(back.y, clientY ?? 0, 1e-6);
      }
    });
  }

  test("the same slide point moves on screen by the pan times the scale", () => {
    const before: Camera = { x: 500, y: 400, zoom: 2 };
    const after: Camera = { x: 530, y: 390, zoom: 2 };
    const point = { x: 480, y: 410 };
    const first = slideToScreen(before, stage, point);
    const second = slideToScreen(after, stage, point);
    close(first.x - second.x, 30 * 4);
    close(first.y - second.y, -10 * 4);
  });

  test("a wider stage keeps the slide point at the same offset from the centre", () => {
    const camera: Camera = { x: 500, y: 400, zoom: 1.5 };
    const point = { x: 480, y: 410 };
    const narrow = slideToScreen(camera, { ...stage, width: 1000 }, point);
    const wide = slideToScreen(camera, { ...stage, width: 1200 }, point);
    close(wide.x - narrow.x, 100);
    close(wide.y, narrow.y);
  });
});

describe("count markers", () => {
  test("a marker keeps its slide point exactly as dropped", () => {
    const point = { x: 1234.5, y: 678.25 };
    const { document: doc, shape } = dropMarker(createDocument(), point, "tumor");
    assert.deepEqual(markerPoint(shape), { x: 1234.5, y: 678.25 });
    assert.equal(markersOf(doc).length, 1);
  });

  test("the Shift-click hit radius shrinks in slide pixels as the zoom grows", () => {
    let doc = createDocument();
    doc = dropMarker(doc, { x: 100, y: 100 }, null).document;
    const id = markersOf(doc)[0]?.id ?? 0;
    for (const zoom of zooms) {
      const radius = markerHitScreenPixels / 2 ** zoom;
      const justInside = { x: 100 + radius * 0.99, y: 100 };
      const justOutside = { x: 100 + radius * 1.01, y: 100 };
      assert.equal(markerNear(doc, justInside, radius), id, `inside at zoom ${zoom}`);
      assert.equal(markerNear(doc, justOutside, radius), null, `outside at zoom ${zoom}`);
    }
  });

  test("the nearest marker wins when several are within reach", () => {
    let doc = createDocument();
    doc = dropMarker(doc, { x: 100, y: 100 }, null).document;
    doc = dropMarker(doc, { x: 104, y: 100 }, null).document;
    const near = markerNear(doc, { x: 103, y: 100 }, 9);
    assert.equal(near, markersOf(doc)[1]?.id);
  });

  test("counts follow the class of each marker and deletion takes one away", () => {
    let doc = createDocument();
    doc = dropMarker(doc, { x: 1, y: 1 }, "a").document;
    doc = dropMarker(doc, { x: 2, y: 1 }, "a").document;
    doc = dropMarker(doc, { x: 3, y: 1 }, "b").document;
    doc = dropMarker(doc, { x: 4, y: 1 }, null).document;
    assert.deepEqual(countByClass(doc, ["a", "b"]), [
      { classKey: "a", count: 2 },
      { classKey: "b", count: 1 },
      { classKey: "", count: 1 },
    ]);
    const second = markersOf(doc)[1]?.id ?? 0;
    const fewer = deleteMarker(doc, second);
    assert.deepEqual(countByClass(fewer, ["a", "b"]), [
      { classKey: "a", count: 1 },
      { classKey: "b", count: 1 },
      { classKey: "", count: 1 },
    ]);
  });

  test("deleting a shape that is not a marker changes nothing", () => {
    const doc = addArrow(createDocument(), { from: { x: 0, y: 0 }, to: { x: 10, y: 10 } });
    const id = arrowsOf(doc)[0]?.id ?? 0;
    assert.equal(deleteMarker(doc, id), doc);
  });
});

describe("arrows and text", () => {
  test("an arrow drawn in screen space at any zoom reads back to the same slide ends", () => {
    for (const camera of cameras) {
      const from = screenToSlide(camera, stage, 200, 300);
      const to = screenToSlide(camera, stage, 650, 480);
      const doc = addArrow(createDocument(), { from, to });
      const arrow = arrowsOf(doc)[0];
      assert.ok(arrow);
      const ends = arrowEndsOf(arrow);
      close(ends.from.x, from.x, Math.abs(from.x) * 1e-6 + 1e-3);
      close(ends.to.y, to.y, Math.abs(to.y) * 1e-6 + 1e-3);
    }
  });

  test("Shift snaps the arrow end in slide space whatever the zoom", () => {
    for (const camera of cameras) {
      const from = screenToSlide(camera, stage, 200, 300);
      const raw = screenToSlide(camera, stage, 500, 310);
      const snapped = snapToAngle(from, raw);
      close(snapped.y, from.y, 1e-6);
      const onScreen = slideToScreen(camera, stage, snapped);
      close(onScreen.y, 300, 1e-6);
    }
  });

  test("text keeps its point and trims its words, and empty text adds nothing", () => {
    const doc = addText(createDocument(), { point: { x: 5.5, y: 6.5 }, text: "  edge  " });
    const shape = textsOf(doc)[0];
    assert.equal(shape?.text, "edge");
    assert.deepEqual({ x: shape?.points[0], y: shape?.points[1] }, { x: 5.5, y: 6.5 });
    const same = addText(doc, { point: { x: 1, y: 1 }, text: "   " });
    assert.equal(same, doc);
  });
});

describe("comment pins", () => {
  test("a pin on empty slide keeps its point and a move keeps the new one", () => {
    let doc = placePin(createDocument(), "t1", { x: 10, y: 20 }, 2);
    assert.deepEqual(pinPoint(doc, "t1", null), { x: 10, y: 20 });
    doc = movePin(doc, "t1", { x: 30.5, y: 40.25 }, 2);
    assert.deepEqual(pinPoint(doc, "t1", null), { x: 30.5, y: 40.25 });
  });

  test("a pin dropped on a marker keeps its offset from the marker at any zoom", () => {
    const base = dropMarker(createDocument(), { x: 100, y: 100 }, null).document;
    for (const zoom of zooms) {
      const tolerance = 6 / 2 ** zoom;
      const doc = placePin(base, "t1", { x: 100 + tolerance * 0.5, y: 100 }, tolerance);
      const placement = doc.pins.get("t1");
      assert.equal(placement?.shapeId, markersOf(doc)[0]?.id, `linked at zoom ${zoom}`);
      close(pinPoint(doc, "t1", null)?.x ?? 0, 100 + tolerance * 0.5);
    }
  });
});

describe("ruler lengths across zoom and spacing", () => {
  test("the same screen drag measures the same microns only when the zoom matches", () => {
    const lengths = zooms.map((zoom) => {
      const camera: Camera = { x: 512, y: 384, zoom };
      const from = screenToSlide(camera, stage, 200, 300);
      const to = screenToSlide(camera, stage, 600, 300);
      return rulerMicrons({ from, to }, 0.25) ?? 0;
    });
    for (const [index, zoom] of zooms.entries()) {
      close(lengths[index] ?? 0, (400 / 2 ** zoom) * 0.25, 1e-6);
    }
  });

  test("the label at each spacing is the slide length times the spacing", () => {
    const segment = { from: { x: 0, y: 0 }, to: { x: 600, y: 800 } };
    assert.equal(formatRulerLength(segment, 0.25), "250 µm");
    assert.equal(formatRulerLength(segment, 0.5), "500 µm");
    assert.equal(formatRulerLength(segment, 0.05), "50.0 µm");
    assert.equal(formatRulerLength(segment, 1), "1.00 mm");
    assert.equal(formatRulerLength(segment, 0.2271), "227 µm");
    assert.equal(formatRulerLength(segment, null), "1000 px");
  });
});
