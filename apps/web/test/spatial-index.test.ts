import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addGroup, addShape, createDocument, updateGroup } from "../src/annotations/document.ts";
import { pickShape, shapesInExtent } from "../src/annotations/hit-test.ts";
import { buildBoundsIndex } from "../src/annotations/spatial-index.ts";

function collect(index: ReturnType<typeof buildBoundsIndex>, box: number[]): number[] {
  const found: number[] = [];
  index.query(box[0] ?? 0, box[1] ?? 0, box[2] ?? 0, box[3] ?? 0, (item) => found.push(item));
  return found.sort((a, b) => a - b);
}

describe("bounds index", () => {
  const bounds = Float32Array.from([
    0, 0, 10, 10, 20, 20, 30, 30, 5, 5, 500, 500, 100, 100, 101, 101,
  ]);

  test("returns every box that touches the query and none that do not", () => {
    const index = buildBoundsIndex(bounds);
    assert.deepEqual(collect(index, [8, 8, 9, 9]), [0, 2]);
    assert.deepEqual(collect(index, [25, 25, 26, 26]), [1, 2]);
    assert.deepEqual(collect(index, [100.5, 100.5, 100.6, 100.6]), [2, 3]);
    assert.deepEqual(collect(index, [900, 900, 901, 901]), []);
  });

  test("skips inactive items and never reports one twice", () => {
    const index = buildBoundsIndex(bounds, Uint8Array.from([1, 0, 1, 1]));
    assert.deepEqual(collect(index, [0, 0, 600, 600]), [0, 2, 3]);
  });

  test("an empty or fully inactive set finds nothing", () => {
    assert.deepEqual(collect(buildBoundsIndex(new Float32Array(0)), [0, 0, 1, 1]), []);
    assert.deepEqual(collect(buildBoundsIndex(bounds, new Uint8Array(4)), [0, 0, 600, 600]), []);
  });
});

describe("indexed picking ignores hidden and locked groups", () => {
  function square(x: number, y: number): Float32Array {
    return Float32Array.from([x, y, x + 10, y, x + 10, y + 10, x, y + 10]);
  }

  test("only shapes outside hidden or locked groups can be picked or boxed", () => {
    let doc = createDocument();
    const open = addGroup(doc, "Open");
    doc = open.document;
    const hidden = addGroup(doc, "Hidden", { hidden: true });
    doc = hidden.document;
    const locked = addGroup(doc, "Locked", { locked: true });
    doc = locked.document;
    const a = addShape(doc, { kind: "polygon", points: square(0, 0), groupId: open.group.id });
    doc = a.document;
    const b = addShape(doc, { kind: "polygon", points: square(0, 0), groupId: hidden.group.id });
    doc = b.document;
    const c = addShape(doc, { kind: "polygon", points: square(0, 0), groupId: locked.group.id });
    doc = c.document;
    assert.equal(pickShape(doc, { x: 5, y: 5 }, 2)?.id, a.shape.id);
    assert.deepEqual(
      shapesInExtent(doc, [0, 0, 20, 20]).map((shape) => shape.id),
      [a.shape.id],
    );
    const reopened = updateGroup(doc, hidden.group.id, { hidden: false });
    assert.equal(pickShape(reopened.document, { x: 5, y: 5 }, 2)?.id, b.shape.id);
  });
});
