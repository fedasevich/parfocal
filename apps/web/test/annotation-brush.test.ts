import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { AnnotationDraft } from "@parfocal/api-client";
import {
  applyToRegion,
  brushDefaultSize,
  brushMaxSize,
  brushMinSize,
  brushModeOf,
  clampBrushSize,
  mapOf,
  paintStroke,
  stepBrushSize,
} from "../src/annotations/brush.ts";
import { type AnnotationDocument, addShape, createDocument } from "../src/annotations/document.ts";
import { brushGeometryOf } from "../src/annotations/geojson.ts";
import { createHistory, record, redo, undo } from "../src/annotations/history.ts";
import { draftOf, type SavedRecord, sameBody, shapeOf } from "../src/annotations/saved-shapes.ts";
import { type Geometry, ringCount, ringOf } from "../src/annotations/shapes.ts";

const line = (x0: number, x1: number, y: number) => [
  { x: x0, y },
  { x: x1, y },
];

const areaOf = (geometry: Geometry | null): number => {
  if (geometry === null) return 0;
  let total = 0;
  for (let r = 0; r < ringCount(geometry); r++) {
    const ring = ringOf(geometry, r);
    let sum = 0;
    const count = ring.length / 2;
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      sum +=
        (ring[i * 2] ?? 0) * (ring[j * 2 + 1] ?? 0) - (ring[j * 2] ?? 0) * (ring[i * 2 + 1] ?? 0);
    }
    total += sum / 2;
  }
  return total;
};

const savedOf = (draft: AnnotationDraft): SavedRecord => ({
  kind: draft.kind,
  geometry: structuredClone({ ...draft.geometry }),
  class_id: draft.class_id ?? null,
});

const paint = (doc: AnnotationDocument, x0: number, x1: number, y: number, diameter: number) =>
  paintStroke(doc, { points: line(x0, x1, y), diameter, mode: "paint", classKey: "tumor" });

const erase = (doc: AnnotationDocument, x0: number, x1: number, y: number, diameter: number) =>
  paintStroke(doc, { points: line(x0, x1, y), diameter, mode: "erase", classKey: "tumor" });

describe("brush size and modifiers", () => {
  test("size stays between 4 and 160 pixels", () => {
    assert.equal(clampBrushSize(1), brushMinSize);
    assert.equal(clampBrushSize(999), brushMaxSize);
    assert.equal(clampBrushSize(Number.NaN), brushDefaultSize);
    assert.equal(brushMinSize, 4);
    assert.equal(brushMaxSize, 160);
  });

  test("stepping always moves and never leaves the range", () => {
    assert.ok(stepBrushSize(4, 1) > 4);
    assert.equal(stepBrushSize(4, -1), 4);
    assert.equal(stepBrushSize(160, 1), 160);
    assert.ok(stepBrushSize(160, -1) < 160);
  });

  test("shift or alt erases and nothing else paints", () => {
    assert.equal(brushModeOf({ shiftKey: false, altKey: false }), "paint");
    assert.equal(brushModeOf({ shiftKey: true, altKey: false }), "erase");
    assert.equal(brushModeOf({ shiftKey: false, altKey: true }), "erase");
  });
});

describe("painting", () => {
  test("a stroke makes one map shape that covers the swept strip", () => {
    const doc = paint(createDocument(), 100, 300, 100, 40);
    const map = mapOf(doc, "tumor");
    assert.ok(map);
    assert.equal(map.kind, "brush");
    const expected = 200 * 40 + Math.PI * 20 * 20;
    assert.ok(Math.abs(areaOf(map) - expected) < expected * 0.02);
  });

  test("a click paints a round dab", () => {
    const doc = paintStroke(createDocument(), {
      points: [{ x: 50, y: 50 }],
      diameter: 30,
      mode: "paint",
      classKey: "tumor",
    });
    const area = areaOf(mapOf(doc, "tumor"));
    assert.ok(Math.abs(area - Math.PI * 15 * 15) < Math.PI * 15 * 15 * 0.03);
  });

  test("overlapping strokes merge into one region without double counting", () => {
    const first = paint(createDocument(), 100, 300, 100, 40);
    const second = paint(first, 200, 400, 100, 40);
    const map = mapOf(second, "tumor");
    assert.ok(map);
    assert.equal(ringCount(map), 1);
    const expected = 300 * 40 + Math.PI * 20 * 20;
    assert.ok(Math.abs(areaOf(map) - expected) < expected * 0.02);
    assert.equal(second.shapes.size, 1);
  });

  test("separate strokes stay as separate rings of one shape", () => {
    const doc = paint(paint(createDocument(), 0, 100, 0, 20), 0, 100, 200, 20);
    const map = mapOf(doc, "tumor");
    assert.ok(map);
    assert.equal(ringCount(map), 2);
    assert.equal(doc.shapes.size, 1);
  });

  test("each class keeps its own map", () => {
    let doc = paint(createDocument(), 0, 100, 0, 20);
    doc = paintStroke(doc, {
      points: line(0, 100, 500),
      diameter: 20,
      mode: "paint",
      classKey: "stroma",
    });
    assert.equal(doc.shapes.size, 2);
    assert.notEqual(mapOf(doc, "tumor"), mapOf(doc, "stroma"));
  });
});

describe("erasing", () => {
  test("erasing across a painted strip removes only the swept part", () => {
    const painted = paint(createDocument(), 100, 500, 100, 60);
    const before = areaOf(mapOf(painted, "tumor"));
    const erased = erase(painted, 280, 320, 100, 20);
    const after = areaOf(mapOf(erased, "tumor"));
    assert.ok(after < before);
    const swept = 40 * 20 + Math.PI * 10 * 10;
    assert.ok(Math.abs(before - after - swept) < swept * 0.03);
  });

  test("erasing through the middle of a strip splits it in two", () => {
    const painted = paint(createDocument(), 100, 500, 100, 20);
    const cut = paintStroke(painted, {
      points: [
        { x: 300, y: 50 },
        { x: 300, y: 150 },
      ],
      diameter: 20,
      mode: "erase",
      classKey: "tumor",
    });
    const map = mapOf(cut, "tumor");
    assert.ok(map);
    assert.equal(ringCount(map), 2);
  });

  test("erasing inside a wide area leaves a hole", () => {
    const painted = paint(createDocument(), 100, 300, 100, 120);
    const holed = paintStroke(painted, {
      points: [{ x: 200, y: 100 }],
      diameter: 20,
      mode: "erase",
      classKey: "tumor",
    });
    const map = mapOf(holed, "tumor");
    assert.ok(map);
    assert.equal(ringCount(map), 2);
    assert.ok(areaOf(map) < areaOf(mapOf(painted, "tumor")));
  });

  test("erasing everything removes the shape and erasing an empty map changes nothing", () => {
    const painted = paintStroke(createDocument(), {
      points: [{ x: 50, y: 50 }],
      diameter: 20,
      mode: "paint",
      classKey: "tumor",
    });
    const gone = paintStroke(painted, {
      points: [{ x: 50, y: 50 }],
      diameter: 100,
      mode: "erase",
      classKey: "tumor",
    });
    assert.equal(gone.shapes.size, 0);
    const empty = createDocument();
    assert.equal(erase(empty, 0, 10, 0, 10), empty);
  });

  test("applyToRegion erases nothing from no region", () => {
    assert.equal(
      applyToRegion(null, { points: line(0, 10, 0), diameter: 10, mode: "erase" }),
      null,
    );
  });
});

describe("undo", () => {
  test("one stroke is one history step that undo and redo move across", () => {
    const start = createDocument();
    const painted = paint(start, 100, 300, 100, 40);
    const erased = erase(painted, 150, 250, 100, 20);
    let history = createHistory();
    history = record(history, start, painted, "Paint map").history;
    history = record(history, painted, erased, "Erase map").history;
    const back = undo(history);
    assert.ok(back);
    assert.equal(back.document, painted);
    const further = undo(back.history);
    assert.ok(further);
    assert.equal(further.document, start);
    const forward = redo(further.history);
    assert.ok(forward);
    assert.equal(forward.document, painted);
  });
});

describe("persistence", () => {
  test("a painted map with a hole saves as a multi polygon and loads back the same", () => {
    const painted = paint(createDocument(), 100, 300, 100, 120);
    const holed = paintStroke(painted, {
      points: [{ x: 200, y: 100 }],
      diameter: 20,
      mode: "erase",
      classKey: "tumor",
    });
    const map = mapOf(holed, "tumor");
    assert.ok(map);
    const draft = draftOf(map);
    assert.ok(draft);
    assert.equal(draft.kind, "region");
    assert.equal(draft.geometry.type, "MultiPolygon");
    assert.equal(draft.class_id, "tumor");
    const restored = shapeOf(savedOf(draft));
    assert.ok(restored);
    assert.equal(restored.kind, "brush");
    assert.equal(restored.classKey, "tumor");
    const reloaded = mapOf(addShape(createDocument(), restored).document, "tumor");
    assert.ok(reloaded);
    assert.equal(ringCount(reloaded), 2);
    assert.ok(Math.abs(areaOf(reloaded) - areaOf(map)) < 1);
    assert.equal(sameBody(map, reloaded), true);
  });

  test("a restored map keeps painting and erasing correctly", () => {
    const painted = paint(createDocument(), 100, 300, 100, 40);
    const map = mapOf(painted, "tumor");
    assert.ok(map);
    const draft = draftOf(map);
    assert.ok(draft);
    const restored = shapeOf(savedOf(draft));
    assert.ok(restored);
    const doc = addShape(createDocument(), restored).document;
    const wider = paint(doc, 300, 500, 100, 40);
    assert.equal(ringCount(mapOf(wider, "tumor") as Geometry), 1);
    const cut = erase(doc, 0, 1000, 100, 200);
    assert.equal(cut.shapes.size, 0);
  });

  test("a plain polygon still loads as a polygon", () => {
    const record = {
      kind: "region",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 0],
          ],
        ],
      },
    };
    assert.equal(brushGeometryOf(record), null);
    assert.equal(shapeOf(record)?.kind, "polygon");
  });
});
