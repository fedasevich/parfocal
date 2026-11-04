import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addGroup,
  addShape,
  createDocument,
  moveShape,
  removeShape,
  updateGroup,
  updateShape,
} from "../src/annotations/document.ts";
import { createHistory, record, undo } from "../src/annotations/history.ts";
import { dropPin, movePin, pinPoint, placePin, pointOfAnchor } from "../src/annotations/pins.ts";

const square = (x: number, y: number, size: number) =>
  new Float32Array([x, y, x + size, y, x + size, y + size, x, y + size]);

const tolerance = 2;

function slideWithSquare() {
  const added = addShape(createDocument(), { kind: "polygon", points: square(100, 100, 100) });
  return { doc: added.document, id: added.shape.id };
}

describe("placing a pin", () => {
  test("a pin on empty slide keeps its own spot and links no shape", () => {
    const { doc } = slideWithSquare();
    const placed = placePin(doc, "t1", { x: 500, y: 500 }, tolerance);
    assert.deepEqual(placed.pins.get("t1"), { shapeId: null, offset: { x: 500, y: 500 } });
    assert.deepEqual(pinPoint(placed, "t1", null), { x: 500, y: 500 });
  });

  test("a pin inside a shape stores an offset from the shape and links the thread", () => {
    const { doc, id } = slideWithSquare();
    const placed = placePin(doc, "t1", { x: 130, y: 120 }, tolerance);
    assert.deepEqual(placed.pins.get("t1"), { shapeId: id, offset: { x: -20, y: -30 } });
    assert.deepEqual(placed.shapes.get(id)?.threadIds, ["t1"]);
  });

  test("a thread with no placement falls back to its saved point", () => {
    const { doc } = slideWithSquare();
    assert.deepEqual(pinPoint(doc, "t9", { x: 7, y: 8 }), { x: 7, y: 8 });
    assert.equal(pinPoint(doc, "t9", null), null);
  });

  test("only a point anchor gives a saved point", () => {
    assert.deepEqual(
      pointOfAnchor({ kind: "point", geometry: { type: "Point", coordinates: [3, 4] } }),
      { x: 3, y: 4 },
    );
    assert.equal(pointOfAnchor({ kind: "object", geometry: null }), null);
  });
});

describe("a pin follows its shape", () => {
  test("moving the shape moves the pin by the same distance", () => {
    const { doc, id } = slideWithSquare();
    const placed = placePin(doc, "t1", { x: 130, y: 120 }, tolerance);
    const moved = moveShape(placed, id, 40, -10).document;
    assert.deepEqual(pinPoint(moved, "t1", null), { x: 170, y: 110 });
  });

  test("reshaping the shape keeps the pin at the same offset from its centre", () => {
    const { doc, id } = slideWithSquare();
    const placed = placePin(doc, "t1", { x: 150, y: 150 }, tolerance);
    const grown = updateShape(placed, id, {
      geometry: { points: square(100, 100, 200), ringStarts: Uint32Array.of(0, 4) },
    }).document;
    assert.deepEqual(pinPoint(grown, "t1", null), { x: 200, y: 200 });
  });

  test("the pin hides with a hidden group and returns with it", () => {
    const { doc, id } = slideWithSquare();
    const grouped = addGroup(doc, "Tumor");
    const inGroup = updateShape(grouped.document, id, { groupId: grouped.group.id }).document;
    const placed = placePin(inGroup, "t1", { x: 130, y: 120 }, tolerance);
    const hidden = updateGroup(placed, grouped.group.id, { hidden: true }).document;
    assert.equal(pinPoint(hidden, "t1", null), null);
    const shown = updateGroup(hidden, grouped.group.id, { hidden: false }).document;
    assert.deepEqual(pinPoint(shown, "t1", null), { x: 130, y: 120 });
  });

  test("the pin hides when its shape is deleted", () => {
    const { doc, id } = slideWithSquare();
    const placed = placePin(doc, "t1", { x: 130, y: 120 }, tolerance);
    assert.equal(pinPoint(removeShape(placed, id), "t1", null), null);
  });
});

describe("dragging a pin", () => {
  test("dropping on another shape relinks it and dropping on empty slide frees it", () => {
    const first = addShape(createDocument(), { kind: "polygon", points: square(0, 0, 100) });
    const second = addShape(first.document, { kind: "polygon", points: square(300, 0, 100) });
    const placed = placePin(second.document, "t1", { x: 50, y: 50 }, tolerance);
    const over = movePin(placed, "t1", { x: 350, y: 50 }, tolerance);
    assert.equal(over.pins.get("t1")?.shapeId, second.shape.id);
    assert.deepEqual(over.shapes.get(first.shape.id)?.threadIds, []);
    assert.deepEqual(over.shapes.get(second.shape.id)?.threadIds, ["t1"]);
    const freed = movePin(over, "t1", { x: 700, y: 700 }, tolerance);
    assert.deepEqual(freed.pins.get("t1"), { shapeId: null, offset: { x: 700, y: 700 } });
    assert.deepEqual(freed.shapes.get(second.shape.id)?.threadIds, []);
  });

  test("a drag is one history step and undo puts the pin back", () => {
    const { doc, id } = slideWithSquare();
    const placed = placePin(doc, "t1", { x: 130, y: 120 }, tolerance);
    const dragged = movePin(placed, "t1", { x: 170, y: 180 }, tolerance);
    const recorded = record(createHistory(), placed, dragged, "Move comment pin");
    assert.deepEqual(pinPoint(dragged, "t1", null), { x: 170, y: 180 });
    const back = undo(recorded.history);
    assert.equal(back?.label, "Move comment pin");
    assert.deepEqual(back && pinPoint(back.document, "t1", null), { x: 130, y: 120 });
    assert.deepEqual(back?.document.pins.get("t1")?.shapeId, id);
  });

  test("dropping a pin forgets its placement", () => {
    const { doc } = slideWithSquare();
    const placed = placePin(doc, "t1", { x: 130, y: 120 }, tolerance);
    assert.equal(dropPin(placed, "t1").pins.has("t1"), false);
    assert.equal(dropPin(doc, "t1"), doc);
  });
});
