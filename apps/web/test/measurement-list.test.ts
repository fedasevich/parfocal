import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addGroup, addShape, createDocument, updateGroup } from "../src/annotations/document.ts";
import {
  buildMeasurementRows,
  formatDrawnTime,
  noteDrawnTimes,
} from "../src/measure/measurement-list.ts";

describe("the measurement list", () => {
  test("lists rulers and closed shapes in drawing order with labels M1 and up", () => {
    let doc = createDocument();
    doc = addShape(doc, { kind: "ruler", points: Float32Array.of(0, 0, 2000, 0) }).document;
    doc = addShape(doc, { kind: "point", points: Float32Array.of(5, 5) }).document;
    doc = addShape(doc, {
      kind: "rectangle",
      points: Float32Array.of(0, 0, 4000, 2000),
      classKey: "t",
    }).document;
    const rows = buildMeasurementRows(doc, 0.5, new Map(), new Map([["t", "Tumor"]]));
    assert.deepEqual(
      rows.map((row) => [row.label, row.kind, row.value, row.area, row.category]),
      [
        ["M1", "ruler", "1.00 mm", null, "Ruler"],
        ["M2", "area", "6.00 mm", "2.00 mm²", "Tumor"],
      ],
    );
  });

  test("without a pixel size values stay in pixels", () => {
    const doc = addShape(createDocument(), {
      kind: "rectangle",
      points: Float32Array.of(0, 0, 10, 20),
    }).document;
    const [row] = buildMeasurementRows(doc, null, new Map());
    assert.equal(row?.area, "200 px²");
    assert.equal(row?.value, "60 px");
    assert.equal(row?.category, "No category");
  });

  test("a class key without a name shows the key and a hidden group hides its rows", () => {
    let doc = createDocument();
    const grouped = addGroup(doc, "Checks");
    doc = grouped.document;
    const withShape = addShape(doc, {
      kind: "ellipse",
      points: Float32Array.of(0, 0, 10, 10),
      classKey: "k9",
      groupId: grouped.group.id,
    });
    assert.equal(buildMeasurementRows(withShape.document, null, new Map())[0]?.category, "k9");
    const hidden = updateGroup(withShape.document, grouped.group.id, { hidden: true });
    assert.equal(buildMeasurementRows(hidden.document, null, new Map()).length, 0);
  });

  test("times are noted once, when a shape first appears", () => {
    const first = addShape(createDocument(), {
      kind: "ruler",
      points: Float32Array.of(0, 0, 10, 0),
    });
    const noted = noteDrawnTimes(new Map(), first.document, 1000);
    assert.equal(noted.get(first.shape.id), 1000);
    const second = addShape(first.document, {
      kind: "ruler",
      points: Float32Array.of(0, 0, 20, 0),
    });
    const later = noteDrawnTimes(noted, second.document, 2000);
    assert.equal(later.get(first.shape.id), 1000);
    assert.equal(later.get(second.shape.id), 2000);
    assert.equal(noteDrawnTimes(later, second.document, 3000), later);
  });

  test("the time shows hours and minutes", () => {
    assert.equal(formatDrawnTime(null), "");
    assert.match(formatDrawnTime(Date.now()), /^\d\d:\d\d$/);
  });
});
