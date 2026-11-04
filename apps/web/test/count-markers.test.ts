import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  countByClass,
  deleteMarker,
  dropMarker,
  markerNear,
  markersOf,
  unclassedKey,
} from "../src/annotations/count-markers.ts";
import { createDocument } from "../src/annotations/document.ts";
import { markerPointOf, pointToGeoJson, savedMarkerKind } from "../src/annotations/geojson.ts";

describe("count markers", () => {
  test("a click drops one point of the active class", () => {
    const dropped = dropMarker(createDocument(), { x: 10, y: 20 }, "tumor");
    assert.equal(dropped.shape.kind, "point");
    assert.equal(dropped.shape.classKey, "tumor");
    assert.deepEqual([...dropped.shape.points], [10, 20]);
    assert.equal(markersOf(dropped.document).length, 1);
  });

  test("counts are kept per class and unclassed markers have their own row", () => {
    let doc = createDocument();
    doc = dropMarker(doc, { x: 1, y: 1 }, "tumor").document;
    doc = dropMarker(doc, { x: 2, y: 2 }, "tumor").document;
    doc = dropMarker(doc, { x: 3, y: 3 }, "stroma").document;
    doc = dropMarker(doc, { x: 4, y: 4 }, null).document;
    const counts = countByClass(doc, ["tumor", "stroma", "lymph", unclassedKey]);
    assert.deepEqual(counts, [
      { classKey: "tumor", count: 2 },
      { classKey: "stroma", count: 1 },
      { classKey: "lymph", count: 0 },
      { classKey: unclassedKey, count: 1 },
    ]);
  });

  test("deleting a marker lowers its class count and leaves the others", () => {
    let doc = createDocument();
    const first = dropMarker(doc, { x: 1, y: 1 }, "tumor");
    doc = dropMarker(first.document, { x: 50, y: 50 }, "stroma").document;
    const after = deleteMarker(doc, first.shape.id);
    const counts = countByClass(after, ["tumor", "stroma"]);
    assert.deepEqual(counts, [
      { classKey: "tumor", count: 0 },
      { classKey: "stroma", count: 1 },
    ]);
  });

  test("the nearest marker within the radius is found", () => {
    let doc = createDocument();
    const near = dropMarker(doc, { x: 100, y: 100 }, "tumor");
    doc = dropMarker(near.document, { x: 104, y: 100 }, "tumor").document;
    assert.equal(markerNear(doc, { x: 101, y: 100 }, 5), near.shape.id);
    assert.equal(markerNear(doc, { x: 300, y: 300 }, 5), null);
  });

  test("a marker survives the saved point shape", () => {
    assert.equal(savedMarkerKind, "cell");
    const geometry = pointToGeoJson({ x: 7, y: 9 });
    assert.deepEqual(geometry, { type: "Point", coordinates: [7, 9] });
    const annotation = { ...geometry, geometry } as unknown as Parameters<typeof markerPointOf>[0];
    assert.deepEqual(markerPointOf(annotation), { x: 7, y: 9 });
  });
});
