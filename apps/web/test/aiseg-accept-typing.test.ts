import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toOutlineTypes } from "@parfocal/api-client/fake";
import {
  type OutlineTyper,
  splitForTyping,
  typeAccepted,
  typerBatch,
  typerSized,
  typingTargets,
  withTypings,
} from "../src/aiseg/accept-typing.ts";
import { withSmartRun } from "../src/aiseg/smart-run.ts";
import { emptyPrompts } from "../src/aiseg/smart-select.ts";
import type { SmartSnapshot } from "../src/aiseg/smart-session.ts";
import { addRun, createDocument, getShape, updateShape } from "../src/annotations/document.ts";
import { acceptProposals, pendingProposals } from "../src/annotations/proposals.ts";
import { runFromProposals } from "../src/annotations/runs.ts";
import type { Shape } from "../src/annotations/shapes.ts";

type Outcome = Awaited<ReturnType<typeof typeAccepted>>;

function applied(outcome: Outcome, doc: Parameters<typeof withTypings>[0]) {
  assert.equal(outcome.kind, "typed");
  return outcome.kind === "typed" ? outcome.apply(doc) : doc;
}

const square = (x: number, y: number) =>
  new Float32Array([x - 8, y - 8, x + 8, y - 8, x + 8, y + 8, x - 8, y + 8]);

const seeded: SmartSnapshot = {
  kept: [
    { prompts: emptyPrompts, ring: square(16, 16), confidence: 0.95 },
    { prompts: emptyPrompts, ring: square(48, 16), confidence: 0.6 },
    { prompts: emptyPrompts, ring: square(80, 16), confidence: 0.9 },
    { prompts: emptyPrompts, ring: square(112, 16), confidence: 0.92 },
  ],
  live: null,
  phase: "ready",
  message: null,
  queued: [],
  requests: 0,
};

const calls: { slideId: string; count: number }[] = [];

const fakeServer: OutlineTyper = (slideId, outlines) => {
  calls.push({ slideId, count: outlines.length });
  return Promise.resolve(toOutlineTypes(slideId, outlines));
};

const offline: OutlineTyper = () => Promise.reject(new TypeError("Failed to fetch"));

function acceptedSmartRun(classKey: string | null = null) {
  const doc = withSmartRun(createDocument(), 1, classKey, seeded);
  return acceptProposals(doc);
}

function typingOf(shape: Shape | undefined) {
  assert.ok(shape !== undefined);
  assert.equal(shape.provenance.kind, "model");
  return shape.provenance.kind === "model" ? shape.provenance.typing : undefined;
}

describe("typing one-click accepts with the server typer", () => {
  it("stores HoVer-NeXt types and the doubt flag on seeded smart select accepts", async () => {
    const accepted = acceptedSmartRun();
    const typed = await typeAccepted("slide-1", accepted.document, accepted.shapes, fakeServer);
    const doc = applied(typed, accepted.document);
    const typings = accepted.shapes.map((shape) => typingOf(getShape(doc, shape.id)));

    assert.deepEqual(
      typings.map((typing) => typing?.type),
      ["tumor", "stroma", "immune", "other"],
    );
    for (const typing of typings) {
      assert.ok(typing !== undefined);
      assert.equal(typing.typer, "pathosam-hovernext");
      assert.equal(typing.version, "v1.2");
      const sum = Object.values(typing.probabilities).reduce((total, share) => total + share, 0);
      assert.ok(Math.abs(sum - 1) < 1e-9);
    }
    assert.deepEqual(typings[2]?.alternatives, ["other"]);
    assert.deepEqual(
      typings.map((typing) => typing?.mayNotBeNucleus),
      [false, true, false, true],
    );
    assert.deepEqual(calls.at(-1), { slideId: "slide-1", count: 4 });
  });

  it("keeps the class the expert chose and fills a missing one with the matching class id", async () => {
    const chosen = acceptedSmartRun("area2-tumor");
    const typed = await typeAccepted("slide-1", chosen.document, chosen.shapes, fakeServer);
    const doc = applied(typed, chosen.document);
    for (const shape of chosen.shapes)
      assert.equal(getShape(doc, shape.id)?.classKey, "area2-tumor");

    const blank = acceptedSmartRun();
    const ids: Record<string, string> = { tumor: "class-tumor", stroma: "class-stroma" };
    const classOfType = (type: string) => ids[type] ?? null;
    const filled = await typeAccepted(
      "slide-1",
      blank.document,
      blank.shapes,
      fakeServer,
      classOfType,
    );
    const next = applied(filled, blank.document);
    assert.deepEqual(
      blank.shapes.map((shape) => getShape(next, shape.id)?.classKey),
      ["class-tumor", "class-stroma", null, null],
    );
  });

  it("keeps a class the reviewer picked by key before the typer answered", async () => {
    const blank = acceptedSmartRun();
    const [first] = blank.shapes;
    assert.ok(first !== undefined);
    const typed = await typeAccepted("slide-1", blank.document, blank.shapes, fakeServer, (type) =>
      type === "tumor" ? "class-tumor" : null,
    );
    const picked = updateShape(blank.document, first.id, { classKey: "class-immune" }).document;
    const next = applied(typed, picked);
    assert.equal(getShape(next, first.id)?.classKey, "class-immune");
    assert.equal(typingOf(getShape(next, first.id))?.type, "tumor");
  });

  it("reports an uncalibrated or mismatched answer as a failure", async () => {
    const accepted = acceptedSmartRun();
    const uncalibrated: OutlineTyper = (slideId, outlines) =>
      Promise.resolve({ ...toOutlineTypes(slideId, outlines), calibrated: false });
    const short: OutlineTyper = (slideId, outlines) =>
      Promise.resolve(toOutlineTypes(slideId, outlines.slice(1)));
    for (const typer of [uncalibrated, short]) {
      const outcome = await typeAccepted("slide-1", accepted.document, accepted.shapes, typer);
      assert.deepEqual(outcome, { kind: "failed", count: 4 });
    }
  });

  it("accepts untyped when the typer is offline", async () => {
    const accepted = acceptedSmartRun("area2-tumor");
    assert.equal(accepted.shapes.length, 4);
    const typed = await typeAccepted("slide-1", accepted.document, accepted.shapes, offline);
    assert.deepEqual(typed, { kind: "failed", count: 4 });
    for (const shape of accepted.shapes) {
      const kept = getShape(accepted.document, shape.id);
      assert.equal(kept?.classKey, "area2-tumor");
      assert.equal(typingOf(kept), undefined);
    }
  });

  it("skips outlines the expert reshaped before the typer answered", () => {
    const accepted = acceptedSmartRun();
    const [first, second] = accepted.shapes;
    assert.ok(first !== undefined && second !== undefined);
    const answer = toOutlineTypes(
      "slide-1",
      accepted.shapes.map((shape) => ({ points: Array.from(shape.points) })),
    );
    const reshaped = updateShape(accepted.document, first.id, {
      geometry: { points: square(20, 20), ringStarts: first.ringStarts },
    }).document;
    const doc = withTypings(reshaped, accepted.shapes, answer);
    assert.equal(typingOf(getShape(doc, first.id)), undefined);
    assert.equal(typingOf(getShape(doc, second.id))?.type, "stroma");
  });

  it("types only smart select accepts and ignores a mismatched answer", async () => {
    const other = addRun(
      createDocument(),
      runFromProposals({ id: 1, model: "pathosam", source: "auto-nuclei" }, [
        { points: square(16, 16), confidence: 0.9 },
      ]),
    );
    const accepted = acceptProposals(other);
    assert.deepEqual(typingTargets(accepted.document, accepted.shapes), []);
    assert.deepEqual(
      await typeAccepted("slide-1", accepted.document, accepted.shapes, fakeServer),
      { kind: "nothing" },
    );

    const smart = acceptedSmartRun();
    const short = toOutlineTypes("slide-1", [{ points: Array.from(square(16, 16)) }]);
    assert.equal(withTypings(smart.document, smart.shapes, short), smart.document);
  });

  it("leaves a ring too wide or too long for the typer untyped", () => {
    const wide = new Float32Array([0, 0, 600, 0, 600, 20, 0, 20]);
    const long = new Float32Array(4098).map((_, index) => index % 7);
    assert.equal(typerSized(square(16, 16)), true);
    assert.equal(typerSized(wide), false);
    assert.equal(typerSized(long), false);
    const doc = withSmartRun(createDocument(), 1, null, {
      ...seeded,
      kept: [
        { prompts: emptyPrompts, ring: square(16, 16), confidence: 0.9 },
        { prompts: emptyPrompts, ring: wide, confidence: 0.9 },
      ],
    });
    const accepted = acceptProposals(doc);
    assert.equal(typingTargets(accepted.document, accepted.shapes).length, 1);
  });

  it("sends only typer sized smart pieces and keeps the rest with their class", () => {
    const wide = new Float32Array([0, 0, 600, 0, 600, 20, 0, 20]);
    const smart = withSmartRun(createDocument(), 1, "class-tumor", {
      ...seeded,
      kept: [
        { prompts: emptyPrompts, ring: square(16, 16), confidence: 0.9 },
        { prompts: emptyPrompts, ring: wide, confidence: 0.9 },
      ],
    });
    const doc = addRun(
      smart,
      runFromProposals({ id: 2, model: "pathosam", source: "auto-nuclei" }, [
        { points: square(80, 80), confidence: 0.9 },
      ]),
    );
    const pending = pendingProposals(doc);
    const on = splitForTyping(pending, true);
    assert.deepEqual(
      on.typed.map((piece) => [piece.runId, piece.piece]),
      [[1, 0]],
    );
    assert.deepEqual(
      on.kept.map((piece) => [piece.runId, piece.piece]),
      [
        [1, 1],
        [2, 0],
      ],
    );
    const off = splitForTyping(pending, false);
    assert.equal(off.typed.length, 0);
    assert.equal(off.kept.length, 3);

    const first = acceptProposals(doc, on.typed, { classKey: null });
    const second = acceptProposals(first.document, on.kept);
    assert.deepEqual(
      second.shapes.map((shape) => shape.classKey),
      ["class-tumor", null],
    );
  });

  it("sends at most one typer batch and keeps the rest", () => {
    const many = Array.from({ length: typerBatch + 2 }, () => ({
      run: { source: "smart-select" },
      ring: square(16, 16),
    }));
    const split = splitForTyping(many, true);
    assert.equal(split.typed.length, typerBatch);
    assert.equal(split.kept.length, 2);
  });
});
