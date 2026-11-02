import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type AnnotationDocument,
  addGroup,
  addRun,
  addShape,
  createDocument,
  groupPath,
  isShapeHidden,
  isShapeLocked,
  linkThread,
  listShapes,
  moveShape,
  openPieces,
  promotedShape,
  promoteRunPiece,
  removeGroup,
  removeRun,
  removeShape,
  shapesOfThread,
  UnknownEntryError,
  unlinkThread,
  updateGroup,
  updateShape,
  visibleShapes,
} from "../src/annotations/document.ts";
import { pieceBounds, pieceRing, runBytes, runFromProposals } from "../src/annotations/runs.ts";
import {
  InvalidShapeError,
  outlineOf,
  ringCount,
  ringOf,
  type ShapeKind,
  shapeKinds,
  singleRing,
} from "../src/annotations/shapes.ts";

const square = Float32Array.of(0, 0, 10, 0, 10, 10, 0, 10);
const corners = Float32Array.of(2, 4, 12, 24);
const pair = Float32Array.of(0, 0, 30, 40);
const single = Float32Array.of(5, 6);

const samples: Record<ShapeKind, { points: Float32Array; text?: string }> = {
  polygon: { points: square },
  freehand: { points: square },
  rectangle: { points: corners },
  ellipse: { points: corners },
  point: { points: single },
  ruler: { points: pair },
  arrow: { points: pair },
  text: { points: single, text: "Check margin" },
  brush: { points: square },
};

function modelRun(id = 7): ReturnType<typeof runFromProposals> {
  return runFromProposals({ id, model: "nuclei-seg", version: "2.1", classKey: "tumor" }, [
    { points: Float32Array.of(0, 0, 4, 0, 4, 4), confidence: 0.9 },
    { points: Float32Array.of(10, 10, 14, 10, 14, 14, 10, 14), confidence: 0.55 },
    { points: Float32Array.of(20, 20, 26, 20, 23, 26), confidence: 0.7 },
  ]);
}

function withRun(): AnnotationDocument {
  return addRun(createDocument(), modelRun());
}

describe("create", () => {
  for (const kind of shapeKinds) {
    test(`makes a ${kind} with human provenance and defaults`, () => {
      const { document, shape } = addShape(createDocument(), { kind, ...samples[kind] });
      assert.equal(shape.kind, kind);
      assert.deepEqual(shape.provenance, { kind: "human" });
      assert.equal(shape.reviewState, "unreviewed");
      assert.equal(shape.classKey, null);
      assert.equal(shape.groupId, null);
      assert.deepEqual(shape.threadIds, []);
      assert.equal(document.shapes.get(shape.id), shape);
    });
  }

  test("numbers shapes one after another and never reuses a number", () => {
    const first = addShape(createDocument(), { kind: "polygon", points: square });
    const second = addShape(first.document, { kind: "polygon", points: square });
    const afterDelete = removeShape(second.document, second.shape.id);
    const third = addShape(afterDelete, { kind: "polygon", points: square });
    assert.deepEqual([first.shape.id, second.shape.id, third.shape.id], [1, 2, 3]);
  });

  test("leaves the document it was given unchanged", () => {
    const before = createDocument();
    addShape(before, { kind: "polygon", points: square });
    assert.equal(before.shapes.size, 0);
    assert.equal(before.nextShapeId, 1);
  });

  test("computes bounds and a single ring", () => {
    const { shape } = addShape(createDocument(), { kind: "polygon", points: square });
    assert.deepEqual(shape.bounds, [0, 0, 10, 10]);
    assert.equal(ringCount(shape), 1);
    assert.deepEqual([...ringOf(shape, 0)], [...square]);
  });

  test("keeps several rings for a brush region", () => {
    const points = Float32Array.of(0, 0, 4, 0, 4, 4, 10, 10, 14, 10, 14, 14);
    const { shape } = addShape(createDocument(), {
      kind: "brush",
      points,
      ringStarts: Uint32Array.of(0, 3, 6),
    });
    assert.equal(ringCount(shape), 2);
    assert.deepEqual([...ringOf(shape, 1)], [10, 10, 14, 10, 14, 14]);
    assert.deepEqual(shape.bounds, [0, 0, 14, 14]);
  });

  test("keeps class, group, text and review state given at creation", () => {
    const { document, group } = addGroup(createDocument(), "Margins");
    const { shape } = addShape(document, {
      kind: "text",
      ...samples.text,
      classKey: "note",
      groupId: group.id,
      reviewState: "unsure",
    });
    assert.equal(shape.classKey, "note");
    assert.equal(shape.groupId, group.id);
    assert.equal(shape.text, "Check margin");
    assert.equal(shape.reviewState, "unsure");
  });

  test("refuses geometry that does not fit the kind", () => {
    const doc = createDocument();
    const refused = [
      { kind: "polygon", points: Float32Array.of(0, 0, 1, 1) },
      { kind: "rectangle", points: square },
      { kind: "point", points: pair },
      { kind: "ruler", points: single },
      { kind: "polygon", points: Float32Array.of(0, 0, 1, 1, Number.NaN, 2) },
      { kind: "polygon", points: Float32Array.of(0, 0, 1, 1, 2) },
      { kind: "polygon", points: square, ringStarts: Uint32Array.of(0, 2, 4) },
      { kind: "polygon", points: square, ringStarts: Uint32Array.of(0, 3) },
    ] as const;
    for (const input of refused) {
      assert.throws(() => addShape(doc, input), InvalidShapeError, input.kind);
    }
  });

  test("refuses text without words and words on other kinds", () => {
    const doc = createDocument();
    assert.throws(() => addShape(doc, { kind: "text", points: single }), InvalidShapeError);
    assert.throws(
      () => addShape(doc, { kind: "text", points: single, text: "  " }),
      InvalidShapeError,
    );
    assert.throws(
      () => addShape(doc, { kind: "polygon", points: square, text: "x" }),
      InvalidShapeError,
    );
  });

  test("refuses a group that does not exist", () => {
    assert.throws(
      () => addShape(createDocument(), { kind: "polygon", points: square, groupId: 9 }),
      UnknownEntryError,
    );
  });

  test("outlines a rectangle and an ellipse as closed rings", () => {
    const rectangle = addShape(createDocument(), { kind: "rectangle", points: corners }).shape;
    assert.deepEqual([...outlineOf(rectangle)], [2, 4, 12, 4, 12, 24, 2, 24]);
    const ellipse = addShape(createDocument(), { kind: "ellipse", points: corners }).shape;
    const ring = outlineOf(ellipse);
    assert.equal(ring.length, 128);
    assert.ok(Math.abs((ring[0] ?? 0) - 12) < 1e-4);
    assert.ok(Math.abs((ring[1] ?? 0) - 14) < 1e-4);
  });
});

describe("update", () => {
  test("changes class, group, text and review state", () => {
    const grouped = addGroup(createDocument(), "Tumor");
    const added = addShape(grouped.document, { kind: "polygon", points: square });
    const { document, shape } = updateShape(added.document, added.shape.id, {
      classKey: "tumor",
      groupId: grouped.group.id,
      reviewState: "agreed",
    });
    assert.equal(shape.classKey, "tumor");
    assert.equal(shape.groupId, grouped.group.id);
    assert.equal(shape.reviewState, "agreed");
    assert.equal(document.shapes.get(shape.id), shape);
    assert.equal(added.document.shapes.get(shape.id)?.classKey, null);
  });

  test("clears a class and a group with null", () => {
    const grouped = addGroup(createDocument(), "Tumor");
    const added = addShape(grouped.document, {
      kind: "polygon",
      points: square,
      classKey: "tumor",
      groupId: grouped.group.id,
    });
    const { shape } = updateShape(added.document, added.shape.id, {
      classKey: null,
      groupId: null,
    });
    assert.equal(shape.classKey, null);
    assert.equal(shape.groupId, null);
  });

  test("replaces geometry and recomputes bounds", () => {
    const added = addShape(createDocument(), { kind: "polygon", points: square });
    const larger = Float32Array.of(0, 0, 20, 0, 20, 30);
    const { shape } = updateShape(added.document, added.shape.id, {
      geometry: singleRing(larger),
    });
    assert.deepEqual(shape.bounds, [0, 0, 20, 30]);
    assert.equal(ringOf(shape, 0).length, 6);
  });

  test("moves a shape by an offset", () => {
    const added = addShape(createDocument(), { kind: "rectangle", points: corners });
    const { shape } = moveShape(added.document, added.shape.id, 100, -2);
    assert.deepEqual([...shape.points], [102, 2, 112, 22]);
    assert.deepEqual(shape.bounds, [102, 2, 112, 22]);
  });

  test("edits the words of a text note but not to empty", () => {
    const added = addShape(createDocument(), { kind: "text", ...samples.text });
    const { shape } = updateShape(added.document, added.shape.id, { text: "Recheck" });
    assert.equal(shape.text, "Recheck");
    assert.throws(
      () => updateShape(added.document, added.shape.id, { text: "" }),
      InvalidShapeError,
    );
  });

  test("refuses geometry that does not fit the kind", () => {
    const added = addShape(createDocument(), { kind: "rectangle", points: corners });
    assert.throws(
      () => updateShape(added.document, added.shape.id, { geometry: singleRing(square) }),
      InvalidShapeError,
    );
  });

  test("refuses an unknown shape and an unknown group", () => {
    const added = addShape(createDocument(), { kind: "polygon", points: square });
    assert.throws(() => updateShape(added.document, 99, { classKey: "x" }), UnknownEntryError);
    assert.throws(
      () => updateShape(added.document, added.shape.id, { groupId: 5 }),
      UnknownEntryError,
    );
  });

  test("keeps human provenance when a human edits a human shape", () => {
    const added = addShape(createDocument(), { kind: "polygon", points: square });
    const { shape } = moveShape(added.document, added.shape.id, 1, 1);
    assert.deepEqual(shape.provenance, { kind: "human" });
  });
});

describe("delete", () => {
  test("removes the shape and leaves the others", () => {
    const first = addShape(createDocument(), { kind: "polygon", points: square });
    const second = addShape(first.document, { kind: "point", points: single });
    const document = removeShape(second.document, first.shape.id);
    assert.deepEqual(
      listShapes(document).map((shape) => shape.id),
      [second.shape.id],
    );
    assert.equal(second.document.shapes.size, 2);
  });

  test("refuses an unknown shape", () => {
    assert.throws(() => removeShape(createDocument(), 3), UnknownEntryError);
  });
});

describe("groups", () => {
  test("builds a path and inherits hidden and locked from parents", () => {
    const outer = addGroup(createDocument(), "Case", { hidden: true });
    const inner = addGroup(outer.document, "Margins", { parentId: outer.group.id, locked: true });
    const added = addShape(inner.document, {
      kind: "polygon",
      points: square,
      groupId: inner.group.id,
    });
    assert.equal(groupPath(added.document, inner.group.id), "Case / Margins");
    assert.equal(isShapeHidden(added.document, added.shape), true);
    assert.equal(isShapeLocked(added.document, added.shape), true);
    assert.deepEqual(visibleShapes(added.document), []);
  });

  test("shows shapes again when the group is shown", () => {
    const hidden = addGroup(createDocument(), "Case", { hidden: true });
    const added = addShape(hidden.document, {
      kind: "polygon",
      points: square,
      groupId: hidden.group.id,
    });
    const shown = updateGroup(added.document, hidden.group.id, { hidden: false });
    assert.equal(visibleShapes(shown.document).length, 1);
  });

  test("refuses a group inside itself", () => {
    const outer = addGroup(createDocument(), "A");
    const inner = addGroup(outer.document, "B", { parentId: outer.group.id });
    assert.throws(
      () => updateGroup(inner.document, outer.group.id, { parentId: inner.group.id }),
      RangeError,
    );
  });

  test("moves shapes and child groups up when a group is removed", () => {
    const outer = addGroup(createDocument(), "A");
    const inner = addGroup(outer.document, "B", { parentId: outer.group.id });
    const added = addShape(inner.document, {
      kind: "polygon",
      points: square,
      groupId: inner.group.id,
    });
    const document = removeGroup(added.document, inner.group.id);
    assert.equal(document.shapes.get(added.shape.id)?.groupId, outer.group.id);
    const top = removeGroup(document, outer.group.id);
    assert.equal(top.shapes.get(added.shape.id)?.groupId, null);
    assert.equal(top.groups.size, 0);
  });
});

describe("comments link", () => {
  test("links and unlinks a thread without duplicates", () => {
    const added = addShape(createDocument(), { kind: "polygon", points: square });
    const once = linkThread(added.document, added.shape.id, "thread-a");
    const twice = linkThread(once.document, added.shape.id, "thread-a");
    const other = linkThread(twice.document, added.shape.id, "thread-b");
    assert.deepEqual(other.shape.threadIds, ["thread-a", "thread-b"]);
    assert.equal(twice.document, once.document);
    assert.deepEqual(
      shapesOfThread(other.document, "thread-b").map((shape) => shape.id),
      [added.shape.id],
    );
    const removed = unlinkThread(other.document, added.shape.id, "thread-a");
    assert.deepEqual(removed.shape.threadIds, ["thread-b"]);
    assert.deepEqual(shapesOfThread(removed.document, "thread-a"), []);
  });

  test("keeps the link when the shape is edited", () => {
    const added = addShape(createDocument(), { kind: "polygon", points: square });
    const linked = linkThread(added.document, added.shape.id, "thread-a");
    const { shape } = moveShape(linked.document, added.shape.id, 5, 5);
    assert.deepEqual(shape.threadIds, ["thread-a"]);
  });
});

describe("model runs", () => {
  test("hold rings columnar and read each piece without copying", () => {
    const run = modelRun();
    assert.equal(run.count, 3);
    assert.deepEqual([...run.startIndices], [0, 3, 7, 10]);
    assert.equal(run.positions.length, 20);
    assert.deepEqual([...pieceRing(run, 1)], [10, 10, 14, 10, 14, 14, 10, 14]);
    assert.equal(pieceRing(run, 1).buffer, run.positions.buffer);
    assert.deepEqual(pieceBounds(run, 2), [20, 20, 26, 26]);
    assert.deepEqual(run.bounds, [0, 0, 26, 26]);
    assert.equal(run.version, "2.1");
    assert.ok(runBytes(run) > 0);
  });

  test("stay out of the editable shapes", () => {
    const document = withRun();
    assert.equal(document.shapes.size, 0);
    assert.deepEqual(openPieces(document, 7), [0, 1, 2]);
  });

  test("can be removed", () => {
    const promoted = promoteRunPiece(withRun(), 7, 1);
    const document = removeRun(promoted.document, 7);
    assert.equal(document.runs.size, 0);
    assert.equal(document.promoted.size, 0);
    assert.equal(document.shapes.size, 1);
    assert.throws(() => removeRun(document, 7), UnknownEntryError);
  });
});

describe("promotion of a run piece", () => {
  test("makes an editable polygon with the model as provenance", () => {
    const { document, shape } = promoteRunPiece(withRun(), 7, 1);
    assert.equal(shape.kind, "polygon");
    assert.deepEqual([...shape.points], [10, 10, 14, 10, 14, 14, 10, 14]);
    assert.deepEqual(shape.bounds, [10, 10, 14, 14]);
    assert.equal(shape.classKey, "tumor");
    assert.equal(shape.reviewState, "unreviewed");
    assert.equal(shape.provenance.kind, "model");
    if (shape.provenance.kind === "model") {
      assert.equal(shape.provenance.model, "nuclei-seg");
      assert.equal(shape.provenance.version, "2.1");
      assert.equal(shape.provenance.runId, 7);
      assert.equal(shape.provenance.piece, 1);
      assert.ok(Math.abs((shape.provenance.confidence ?? 0) - 0.55) < 1e-6);
      assert.equal(shape.provenance.edited, false);
    }
    assert.equal(document.shapes.get(shape.id), shape);
    assert.equal(promotedShape(document, 7, 1), shape);
  });

  test("copies the ring so the run stays untouched", () => {
    const before = withRun();
    const run = before.runs.get(7);
    assert.ok(run);
    const snapshot = [...run.positions];
    const { document, shape } = promoteRunPiece(before, 7, 0);
    moveShape(document, shape.id, 50, 50);
    assert.notEqual(shape.points.buffer, run.positions.buffer);
    assert.deepEqual([...run.positions], snapshot);
  });

  test("takes class, group and review state from the caller", () => {
    const grouped = addGroup(withRun(), "Reviewed");
    const { shape } = promoteRunPiece(grouped.document, 7, 2, {
      classKey: "stroma",
      groupId: grouped.group.id,
      reviewState: "agreed",
    });
    assert.equal(shape.classKey, "stroma");
    assert.equal(shape.groupId, grouped.group.id);
    assert.equal(shape.reviewState, "agreed");
  });

  test("takes the piece out of the open pieces", () => {
    const { document } = promoteRunPiece(withRun(), 7, 1);
    assert.deepEqual(openPieces(document, 7), [0, 2]);
  });

  test("returns the same shape when the piece is promoted again", () => {
    const first = promoteRunPiece(withRun(), 7, 1);
    const again = promoteRunPiece(first.document, 7, 1);
    assert.equal(again.shape, first.shape);
    assert.equal(again.document, first.document);
    assert.equal(again.document.shapes.size, 1);
  });

  test("marks the shape edited once its geometry changes, and keeps the origin", () => {
    const first = promoteRunPiece(withRun(), 7, 1);
    const classOnly = updateShape(first.document, first.shape.id, { classKey: "stroma" });
    assert.equal(
      classOnly.shape.provenance.kind === "model" && classOnly.shape.provenance.edited,
      false,
    );
    const moved = moveShape(classOnly.document, first.shape.id, 3, 3);
    assert.equal(moved.shape.provenance.kind === "model" && moved.shape.provenance.edited, true);
    assert.equal(moved.shape.provenance.kind === "model" && moved.shape.provenance.piece, 1);
  });

  test("brings the piece back when the shape is deleted", () => {
    const first = promoteRunPiece(withRun(), 7, 1);
    const document = removeShape(first.document, first.shape.id);
    assert.deepEqual(openPieces(document, 7), [0, 1, 2]);
    assert.equal(promotedShape(document, 7, 1), undefined);
    const again = promoteRunPiece(document, 7, 1);
    assert.notEqual(again.shape.id, first.shape.id);
  });

  test("refuses an unknown run or piece", () => {
    const document = withRun();
    assert.throws(() => promoteRunPiece(document, 8, 0), UnknownEntryError);
    assert.throws(() => promoteRunPiece(document, 7, 3), UnknownEntryError);
    assert.throws(() => promoteRunPiece(document, 7, -1), UnknownEntryError);
    assert.throws(() => promoteRunPiece(document, 7, 0.5), UnknownEntryError);
  });

  test("keeps pieces of different runs apart", () => {
    const both = addRun(withRun(), modelRun(70));
    const first = promoteRunPiece(both, 7, 0);
    const second = promoteRunPiece(first.document, 70, 0);
    assert.notEqual(first.shape.id, second.shape.id);
    assert.deepEqual(openPieces(second.document, 7), [1, 2]);
    assert.deepEqual(openPieces(second.document, 70), [1, 2]);
  });
});
