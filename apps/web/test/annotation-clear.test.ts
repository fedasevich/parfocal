import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  clearAll,
  clearConfirmCount,
  clearPrompt,
  deleteShapes,
  needsClearConfirmation,
} from "../src/annotations/clear.ts";
import { addShape, createDocument } from "../src/annotations/document.ts";
import { createHistory, record, redo, undo } from "../src/annotations/history.ts";
import { pinPoint, placePin } from "../src/annotations/pins.ts";

const square = (x: number, y: number, size: number) =>
  new Float32Array([x, y, x + size, y, x + size, y + size, x, y + size]);

function threeShapes() {
  let doc = createDocument();
  const ids: number[] = [];
  for (const x of [0, 200, 400]) {
    const added = addShape(doc, { kind: "polygon", points: square(x, 0, 100) });
    doc = added.document;
    ids.push(added.shape.id);
  }
  return { doc, ids };
}

describe("clearing", () => {
  test("clear removes every shape in one step that undo and redo carry whole", () => {
    const { doc } = threeShapes();
    const cleared = clearAll(doc);
    assert.equal(cleared.removed, 3);
    assert.equal(cleared.document.shapes.size, 0);
    const recorded = record(createHistory(), doc, cleared.document, "Clear all");
    assert.equal(recorded.history.entries.length, 1);
    const back = undo(recorded.history);
    assert.equal(back?.document, doc);
    assert.equal(back?.document.shapes.size, 3);
    const again = back === null ? null : redo(back.history);
    assert.equal(again?.document.shapes.size, 0);
  });

  test("clearing an empty slide changes nothing and records no step", () => {
    const empty = createDocument();
    const cleared = clearAll(empty);
    assert.equal(cleared.document, empty);
    assert.equal(cleared.removed, 0);
    assert.equal(record(createHistory(), empty, cleared.document, "Clear all").id, null);
  });

  test("confirmation starts above the threshold", () => {
    assert.equal(needsClearConfirmation(clearConfirmCount), false);
    assert.equal(needsClearConfirmation(clearConfirmCount + 1), true);
    assert.match(clearPrompt(5001), /5,001 shapes/);
  });
});

describe("comment cleanup on delete", () => {
  test("deleting a shape orphans its pins, which vanish and come back with undo", () => {
    const { doc, ids } = threeShapes();
    const first = ids[0] ?? 0;
    const placed = placePin(doc, "t1", { x: 50, y: 50 }, 2);
    assert.equal(placed.pins.get("t1")?.shapeId, first);
    const deletion = deleteShapes(placed, [first]);
    assert.deepEqual(deletion.orphanedThreads, ["t1"]);
    assert.equal(pinPoint(deletion.document, "t1", null), null);
    const recorded = record(createHistory(), placed, deletion.document, "Delete shape");
    const back = undo(recorded.history);
    assert.deepEqual(back === null ? null : pinPoint(back.document, "t1", null), { x: 50, y: 50 });
  });

  test("pins on empty slide and on other shapes stay", () => {
    const { doc, ids } = threeShapes();
    const onSecond = placePin(doc, "t2", { x: 250, y: 50 }, 2);
    const free = placePin(onSecond, "t3", { x: 900, y: 900 }, 2);
    const deletion = deleteShapes(free, [ids[0] ?? 0]);
    assert.deepEqual(deletion.orphanedThreads, []);
    assert.deepEqual(pinPoint(deletion.document, "t2", null), { x: 250, y: 50 });
    assert.deepEqual(pinPoint(deletion.document, "t3", null), { x: 900, y: 900 });
  });

  test("clear orphans every shape pin and leaves free pins", () => {
    const { doc } = threeShapes();
    const a = placePin(doc, "t1", { x: 50, y: 50 }, 2);
    const b = placePin(a, "t2", { x: 450, y: 50 }, 2);
    const c = placePin(b, "t3", { x: 900, y: 900 }, 2);
    const cleared = clearAll(c);
    assert.deepEqual([...cleared.orphanedThreads].sort(), ["t1", "t2"]);
    assert.equal(pinPoint(cleared.document, "t1", null), null);
    assert.deepEqual(pinPoint(cleared.document, "t3", null), { x: 900, y: 900 });
  });

  test("unknown ids are ignored", () => {
    const { doc } = threeShapes();
    const deletion = deleteShapes(doc, [999]);
    assert.equal(deletion.document, doc);
    assert.equal(deletion.removed, 0);
  });
});
