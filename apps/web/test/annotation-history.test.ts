import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { dropMarker } from "../src/annotations/count-markers.ts";
import {
  type AnnotationDocument,
  addGroup,
  addRun,
  addShape,
  createDocument,
  linkThread,
  moveShape,
  promoteRunPiece,
  removeShape,
  updateGroup,
} from "../src/annotations/document.ts";
import {
  canRedo,
  canUndo,
  createHistory,
  fold,
  type History,
  historyLimit,
  record,
  redo,
  undo,
  undoTarget,
} from "../src/annotations/history.ts";
import { runFromProposals } from "../src/annotations/runs.ts";

const square = (x: number, y: number) => Float32Array.of(x, y, x + 4, y, x + 4, y + 4, x, y + 4);

function snapshot(doc: AnnotationDocument): string {
  return JSON.stringify({
    shapes: [...doc.shapes.values()].map((shape) => ({
      ...shape,
      points: [...shape.points],
      ringStarts: [...shape.ringStarts],
    })),
    groups: [...doc.groups.values()],
    promoted: [...doc.promoted],
  });
}

function add(history: History, doc: AnnotationDocument, label = "Add") {
  const added = addShape(doc, { kind: "polygon", points: square(doc.nextShapeId, 0) });
  const recorded = record(history, doc, added.document, label);
  return { history: recorded.history, doc: added.document };
}

describe("undo ordering", () => {
  test("a draft vertex comes first, then a prompt point, then the last committed edit", () => {
    const base = add(createHistory(), createDocument());
    assert.equal(undoTarget(base.history, { draft: 2, prompts: 1 }), "draft");
    assert.equal(undoTarget(base.history, { draft: 0, prompts: 1 }), "prompt");
    assert.equal(undoTarget(base.history, { draft: 0, prompts: 0 }), "edit");
    assert.equal(undoTarget(createHistory(), { draft: 0, prompts: 0 }), "none");
  });

  test("undo and redo walk the edits in order and a new edit clears redo", () => {
    const first = add(createHistory(), createDocument(), "one");
    const second = add(first.history, first.doc, "two");
    const back = undo(second.history);
    assert.ok(back);
    assert.equal(back.label, "two");
    assert.equal(back.document, first.doc);
    assert.equal(canRedo(back.history), true);
    const again = undo(back.history);
    assert.ok(again);
    assert.equal(again.document.shapes.size, 0);
    assert.equal(canUndo(again.history), false);
    assert.equal(undo(again.history), null);
    const forward = redo(again.history);
    assert.ok(forward);
    assert.equal(forward.label, "one");
    const fresh = add(forward.history, forward.document, "three");
    assert.equal(canRedo(fresh.history), false);
    assert.equal(fresh.history.entries.length, 2);
  });

  test("an unchanged document records nothing", () => {
    const doc = createDocument();
    const { history, id } = record(createHistory(), doc, doc, "Nothing");
    assert.equal(id, null);
    assert.equal(history.entries.length, 0);
  });

  test("the history is bounded", () => {
    let history = createHistory();
    let doc = createDocument();
    for (let index = 0; index < historyLimit + 20; index++) {
      const next = add(history, doc);
      history = next.history;
      doc = next.doc;
    }
    assert.equal(history.entries.length, historyLimit);
    assert.equal(history.cursor, historyLimit);
  });
});

describe("group operations and comments", () => {
  test("a group rename, an outline, a comment link and a delete each undo as one step", () => {
    let history = createHistory();
    let doc = createDocument();
    const grouped = addGroup(doc, "Tumor");
    history = record(history, doc, grouped.document, "Add group").history;
    doc = grouped.document;
    const renamed = updateGroup(doc, grouped.group.id, { name: "Tumour", hidden: true }).document;
    history = record(history, doc, renamed, "Rename group").history;
    doc = renamed;
    const shape = addShape(doc, {
      kind: "polygon",
      points: square(0, 0),
      groupId: grouped.group.id,
    });
    history = record(history, doc, shape.document, "Add outline").history;
    doc = shape.document;
    const linked = linkThread(doc, shape.shape.id, "thread-1").document;
    history = record(history, doc, linked, "Comment").history;
    doc = linked;
    const removed = removeShape(doc, shape.shape.id);
    history = record(history, doc, removed, "Delete").history;

    const states: string[] = [];
    let cursor = history;
    for (;;) {
      const step = undo(cursor);
      if (step === null) break;
      states.push(snapshot(step.document));
      cursor = step.history;
    }
    assert.equal(states.length, 5);
    assert.equal(states[0], snapshot(linked));
    assert.equal(states[1], snapshot(shape.document));
    assert.equal(states.at(-1), snapshot(createDocument()));
  });
});

describe("model run accept", () => {
  const run = runFromProposals({ id: 1, model: "seg", version: "1", classKey: null }, [
    { points: Float32Array.of(0, 0, 4, 0, 4, 4), confidence: 0.9 },
    { points: Float32Array.of(10, 10, 14, 10, 14, 14), confidence: 0.8 },
  ]);
  const start = addRun(createDocument(), run);
  const first = promoteRunPiece(start, 1, 0).document;
  const lateChange = (doc: AnnotationDocument) => promoteRunPiece(doc, 1, 1).document;

  test("accepting a run is one step and late pieces fold into it", () => {
    const accepted = record(createHistory(), start, first, "Accept run");
    assert.ok(accepted.id !== null);
    const late = fold(accepted.history, accepted.id, lateChange);
    assert.equal(late.document?.shapes.size, 2);
    assert.equal(late.history.entries.length, 1);
    const stepped = undo(late.history);
    assert.ok(stepped);
    assert.equal(stepped.document.shapes.size, 0);
    assert.equal(redo(stepped.history)?.document.shapes.size, 2);
  });

  test("folding after the accept was undone leaves the live document alone", () => {
    const accepted = record(createHistory(), start, first, "Accept run");
    assert.ok(accepted.id !== null);
    const undone = undo(accepted.history);
    assert.ok(undone);
    const late = fold(undone.history, accepted.id, lateChange);
    assert.equal(late.document, null);
    assert.equal(redo(late.history)?.document.shapes.size, 2);
  });

  test("folding reaches the edits that came after the accept", () => {
    const accepted = record(createHistory(), start, first, "Accept run");
    assert.ok(accepted.id !== null);
    const moved = moveShape(first, 1, 5, 5).document;
    const afterMove = record(accepted.history, first, moved, "Move");
    const late = fold(afterMove.history, accepted.id, lateChange);
    assert.equal(late.document?.shapes.size, 2);
    assert.equal(undo(late.history)?.document.shapes.size, 2);
  });
});

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe("round trip property", () => {
  test("random edit sequences undo to every earlier state and redo to the last", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const next = random(seed);
      let history = createHistory();
      let doc = createDocument();
      const states = [snapshot(doc)];
      const steps = 5 + Math.floor(next() * 25);
      for (let step = 0; step < steps; step++) {
        const ids = [...doc.shapes.keys()];
        const id = ids[Math.floor(next() * ids.length)] ?? 0;
        const pick = next();
        let after: AnnotationDocument;
        if (pick < 0.3 || ids.length === 0) {
          const origin = { x: next() * 100, y: next() * 100 };
          after = addShape(doc, { kind: "polygon", points: square(origin.x, origin.y) }).document;
        } else if (pick < 0.45) {
          const point = { x: next() * 100, y: next() * 100 };
          after = dropMarker(doc, point, next() < 0.5 ? "a" : null).document;
        } else if (pick < 0.7) {
          after = moveShape(doc, id, next() * 10, next() * 10).document;
        } else if (pick < 0.85) {
          after = removeShape(doc, id);
        } else {
          after = addGroup(doc, `g${step}`).document;
        }
        history = record(history, doc, after, `step ${step}`).history;
        doc = after;
        states.push(snapshot(doc));
      }
      const recorded = history.entries.length;
      assert.equal(recorded, steps, `seed ${seed}`);
      let cursor = history;
      for (let index = recorded - 1; index >= 0; index--) {
        const back = undo(cursor);
        assert.ok(back, `seed ${seed}`);
        cursor = back.history;
        assert.equal(snapshot(back.document), states[index], `seed ${seed} step ${index}`);
      }
      assert.equal(undo(cursor), null);
      for (let index = 0; index < recorded; index++) {
        const forward = redo(cursor);
        assert.ok(forward, `seed ${seed}`);
        cursor = forward.history;
        assert.equal(snapshot(forward.document), states[index + 1], `seed ${seed} redo ${index}`);
      }
      assert.equal(redo(cursor), null);
    }
  });
});
