import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { addRun, createDocument, pieceKey } from "../src/annotations/document.ts";
import { createHistory, record, redo, undo } from "../src/annotations/history.ts";
import {
  bulkPromotionCount,
  ConfirmationRequiredError,
  needsPromotionConfirmation,
  promoteInBulk,
  promoteOnEdit,
  pruneBelow,
  pruneLeastConfident,
} from "../src/annotations/promotion.ts";
import { pendingCount } from "../src/annotations/proposals.ts";
import { runFromProposals } from "../src/annotations/runs.ts";

const triangle = (x: number) => Float32Array.of(x, 0, x + 4, 0, x + 4, 4);

function runOf(confidences: number[]) {
  return runFromProposals(
    { id: 1, model: "seg" },
    confidences.map((confidence, index) => ({ points: triangle(index * 10), confidence })),
  );
}

const start = addRun(createDocument(), runOf([0.9, 0.2, 0.6, 0.4]));

describe("run piece promotion", () => {
  test("bulk promotion turns every pending piece into a shape and undoes in one step", () => {
    const { document, shapes } = promoteInBulk(start);
    assert.equal(shapes.length, 4);
    assert.equal(document.shapes.size, 4);
    assert.equal(pendingCount(document), 0);
    const recorded = record(createHistory(), start, document, "Promote pieces");
    const back = undo(recorded.history);
    assert.ok(back);
    assert.equal(back.document.shapes.size, 0);
    assert.equal(pendingCount(back.document), 4);
    assert.equal(redo(back.history)?.document.shapes.size, 4);
  });

  test("a confidence floor limits what is promoted", () => {
    assert.equal(bulkPromotionCount(start, { minConfidence: 0.5 }), 2);
    assert.equal(promoteInBulk(start, { minConfidence: 0.5 }).document.shapes.size, 2);
  });

  test("more than 5,000 pieces ask for a confirmation first", () => {
    assert.equal(needsPromotionConfirmation(5000), false);
    assert.equal(needsPromotionConfirmation(5001), true);
    const big = addRun(createDocument(), runOf(Array.from({ length: 5001 }, () => 0.5)));
    assert.throws(() => promoteInBulk(big), ConfirmationRequiredError);
    assert.equal(promoteInBulk(big, {}, { confirmed: true }).document.shapes.size, 5001);
  });

  test("editing a pending piece promotes it as an edited shape and undoes", () => {
    const geometry = { points: triangle(100), ringStarts: Uint32Array.of(0, 3) };
    const { document, shapes } = promoteOnEdit(start, { runId: 1, piece: 1 }, geometry);
    const shape = shapes[0];
    assert.ok(shape);
    assert.equal(shape.points[0], 100);
    assert.equal(shape.provenance.kind === "model" && shape.provenance.edited, true);
    assert.equal(document.promoted.get(pieceKey(1, 1)), shape.id);
    assert.equal(pendingCount(document), 3);
    const back = undo(record(createHistory(), start, document, "Edit piece").history);
    assert.equal(back?.document.shapes.size, 0);
    assert.equal(pendingCount(back?.document ?? document), 4);
  });
});

describe("run piece pruning", () => {
  test("drops the least confident pieces and keeps the rest pending", () => {
    const { document, dropped } = pruneLeastConfident(start, 2);
    assert.equal(dropped, 2);
    assert.ok(document.dismissed.has(pieceKey(1, 1)));
    assert.ok(document.dismissed.has(pieceKey(1, 3)));
    assert.equal(pendingCount(document), 2);
  });

  test("pruning below a threshold and undo restore the pieces", () => {
    const pruned = pruneBelow(start, 0.5);
    assert.equal(pruned.dropped, 2);
    const recorded = record(createHistory(), start, pruned.document, "Drop pieces");
    const back = undo(recorded.history);
    assert.ok(back);
    assert.equal(pendingCount(back.document), 4);
    assert.equal(redo(back.history)?.document.dismissed.size, 2);
  });

  test("promoted pieces are never pruned", () => {
    const promoted = promoteInBulk(start, { minConfidence: 0.5 }).document;
    assert.equal(pruneLeastConfident(promoted, 10).dropped, 2);
    assert.equal(pruneLeastConfident(promoted, 10).document.shapes.size, 2);
  });
});
