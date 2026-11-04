import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type AnnotationDocument,
  addGroup,
  addRun,
  createDocument,
  removeRun,
} from "../src/annotations/document.ts";
import { createHistory, record, redo, undo } from "../src/annotations/history.ts";
import {
  acceptProposals,
  discardProposals,
  isPending,
  pendingCount,
  pendingProposals,
} from "../src/annotations/proposals.ts";
import { runFromProposals } from "../src/annotations/runs.ts";

const square = (x: number, y: number) => Float32Array.of(x, y, x + 4, y, x + 4, y + 4, x, y + 4);

const tools = [
  "hand",
  "select",
  "polygon",
  "freehand",
  "rectangle",
  "ellipse",
  "marker",
  "ruler",
  "smart-select",
  "auto-region",
] as const;

type Tool = (typeof tools)[number];

interface Session {
  readonly tool: Tool;
  readonly activeGroupId: number | null;
  readonly document: AnnotationDocument;
}

function sessionWith(tool: Tool): Session {
  const grouped = addGroup(createDocument(), "Tumour");
  const run = runFromProposals({ id: 4, model: "nuclei", source: tool, classKey: "tumour" }, [
    { points: square(0, 0), confidence: 0.9 },
    { points: square(10, 0), confidence: 0.7 },
    { points: square(20, 0), confidence: 0.5 },
  ]);
  return {
    tool,
    activeGroupId: grouped.group.id,
    document: addRun(grouped.document, run),
  };
}

describe("pending proposals", () => {
  for (const tool of tools) {
    test(`are listed while the ${tool} tool is active`, () => {
      const session = sessionWith(tool);
      const pending = pendingProposals(session.document);
      assert.equal(pendingCount(session.document), 3);
      assert.deepEqual(
        pending.map((proposal) => proposal.piece),
        [0, 1, 2],
      );
      assert.ok(pending.every((proposal) => proposal.run.source === tool));
      assert.equal(session.document.shapes.size, 0);
    });
  }

  test("carry confidence and class from their run", () => {
    const [first] = pendingProposals(sessionWith("hand").document);
    assert.equal(first?.classKey, "tumour");
    assert.ok(Math.abs((first?.confidence ?? 0) - 0.9) < 1e-6);
  });
});

describe("accept", () => {
  for (const tool of tools) {
    test(`from the ${tool} tool adds every proposal and leaves the active group alone`, () => {
      const session = sessionWith(tool);
      const accepted = acceptProposals(session.document);
      assert.equal(accepted.shapes.length, 3);
      assert.equal(pendingCount(accepted.document), 0);
      assert.equal(accepted.document.shapes.size, 3);
      for (const shape of accepted.shapes) {
        assert.equal(shape.kind, "polygon");
        assert.equal(shape.groupId, null);
        assert.notEqual(shape.groupId, session.activeGroupId);
        assert.equal(shape.classKey, "tumour");
        assert.equal(shape.provenance.kind, "model");
        assert.equal(shape.reviewState, "unreviewed");
      }
      assert.equal(session.activeGroupId, 1);
      assert.equal(session.tool, tool);
    });
  }

  test("takes only the chosen proposals and skips repeats and unknown ones", () => {
    const { document } = sessionWith("smart-select");
    const accepted = acceptProposals(document, [
      { runId: 4, piece: 1 },
      { runId: 4, piece: 1 },
      { runId: 4, piece: 9 },
      { runId: 99, piece: 0 },
    ]);
    assert.equal(accepted.shapes.length, 1);
    assert.deepEqual(
      pendingProposals(accepted.document).map((proposal) => proposal.piece),
      [0, 2],
    );
  });

  test("accepting twice adds nothing the second time", () => {
    const once = acceptProposals(sessionWith("auto-region").document);
    const twice = acceptProposals(once.document);
    assert.equal(twice.document, once.document);
    assert.equal(twice.shapes.length, 0);
  });

  test("an explicit destination is honoured and never the active group by default", () => {
    const session = sessionWith("polygon");
    const defaulted = acceptProposals(session.document);
    assert.ok(defaulted.shapes.every((shape) => shape.groupId !== session.activeGroupId));
    const placed = acceptProposals(session.document, undefined, { groupId: 1, classKey: null });
    assert.ok(placed.shapes.every((shape) => shape.groupId === 1 && shape.classKey === null));
  });
});

describe("discard", () => {
  for (const tool of tools) {
    test(`from the ${tool} tool drops every proposal without adding shapes`, () => {
      const session = sessionWith(tool);
      const next = discardProposals(session.document);
      assert.equal(pendingCount(next), 0);
      assert.equal(next.shapes.size, 0);
      assert.equal(next.promoted.size, 0);
      assert.equal(next.runs.size, 1);
      assert.equal(session.activeGroupId, 1);
    });
  }

  test("takes only the chosen proposals", () => {
    const { document } = sessionWith("polygon");
    const next = discardProposals(document, [{ runId: 4, piece: 0 }]);
    assert.deepEqual(
      pendingProposals(next).map((proposal) => proposal.piece),
      [1, 2],
    );
    assert.equal(isPending(next, { runId: 4, piece: 0 }), false);
  });

  test("a discarded proposal cannot be accepted afterwards", () => {
    const { document } = sessionWith("polygon");
    const discarded = discardProposals(document);
    assert.equal(acceptProposals(discarded).shapes.length, 0);
    assert.equal(acceptProposals(discarded, [{ runId: 4, piece: 0 }]).shapes.length, 0);
  });

  test("discarding with nothing pending returns the same document", () => {
    const empty = createDocument();
    assert.equal(discardProposals(empty), empty);
    const none = discardProposals(sessionWith("hand").document);
    assert.equal(discardProposals(none), none);
  });

  test("removing the run forgets its discarded pieces", () => {
    const discarded = discardProposals(sessionWith("hand").document);
    const removed = removeRun(discarded, 4);
    assert.equal(removed.dismissed.size, 0);
  });
});

describe("history", () => {
  for (const tool of tools) {
    test(`accept and discard from the ${tool} tool undo and redo`, () => {
      const { document } = sessionWith(tool);
      const accepted = acceptProposals(document).document;
      const first = record(createHistory(), document, accepted, "Accept proposals");
      const discarded = discardProposals(accepted);
      assert.equal(discarded, accepted);

      const back = undo(first.history);
      assert.equal(back?.document, document);
      assert.equal(pendingCount(back?.document ?? document), 3);
      const forward = back === null ? null : redo(back.history);
      assert.equal(forward?.document, accepted);

      const dropped = discardProposals(document);
      const second = record(createHistory(), document, dropped, "Discard proposals");
      const restored = undo(second.history);
      assert.equal(pendingCount(restored?.document ?? dropped), 3);
    });
  }
});
