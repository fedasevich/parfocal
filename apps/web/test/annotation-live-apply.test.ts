import assert from "node:assert/strict";
import { test } from "node:test";
import { addShape, createDocument } from "../src/annotations/document.ts";
import { applyLiveChanges } from "../src/annotations/live-apply.ts";
import type { LayerRecord } from "../src/annotations/live-batch.ts";
import type { Remote } from "../src/annotations/save-queue.ts";
import type { ShapeId } from "../src/annotations/shapes.ts";

const ring = (...points: [number, number][]) => ({
  type: "Polygon",
  coordinates: [[...points, points[0] ?? [0, 0]]],
});

const record = (id: string, version: number, ...points: [number, number][]): LayerRecord => ({
  id,
  version,
  kind: "region",
  geometry: ring(...points),
  class_id: null,
});

test("adds, edits and removes shapes and keeps the remote versions in step", () => {
  const remotes = new Map<ShapeId, Remote>();
  const mine = addShape(createDocument(), {
    kind: "polygon",
    points: Float32Array.of(0, 0, 10, 0, 10, 10),
  });
  remotes.set(mine.shape.id, { id: "mine", version: 1 });

  const added = applyLiveChanges(mine.document, remotes, [
    { kind: "add", annotationId: "theirs", record: record("theirs", 1, [0, 0], [5, 0], [5, 5]) },
  ]);
  assert.equal(added.shapes.size, 2);
  assert.ok([...remotes.values()].some((remote) => remote.id === "theirs"));

  const edited = applyLiveChanges(added, remotes, [
    { kind: "edit", annotationId: "mine", record: record("mine", 2, [0, 0], [20, 0], [20, 20]) },
  ]);
  const shape = edited.shapes.get(mine.shape.id);
  assert.equal(shape?.points[2], 20);
  assert.equal(remotes.get(mine.shape.id)?.version, 2);
  assert.equal(added.shapes.get(mine.shape.id)?.points[2], 10);

  const removed = applyLiveChanges(edited, remotes, [
    { kind: "remove", annotationId: "mine", by: null },
  ]);
  assert.equal(removed.shapes.has(mine.shape.id), false);
  assert.equal(remotes.has(mine.shape.id), false);
});

test("leaves the document alone for a change to a shape it does not hold", () => {
  const doc = createDocument();
  const same = applyLiveChanges(doc, new Map(), [
    { kind: "remove", annotationId: "unknown", by: null },
    { kind: "edit", annotationId: "unknown", record: record("unknown", 2, [0, 0], [1, 0], [1, 1]) },
  ]);
  assert.equal(same, doc);
});
