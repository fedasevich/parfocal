import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toOutlineTypes } from "@parfocal/api-client/fake";
import {
  type OutlineTyper,
  typeAccepted,
  typingTargets,
  withTypings,
} from "../src/aiseg/accept-typing.ts";
import { withSmartRun } from "../src/aiseg/smart-run.ts";
import { emptyPrompts } from "../src/aiseg/smart-select.ts";
import type { SmartSnapshot } from "../src/aiseg/smart-session.ts";
import { addRun, createDocument, getShape, updateShape } from "../src/annotations/document.ts";
import { acceptProposals } from "../src/annotations/proposals.ts";
import { runFromProposals } from "../src/annotations/runs.ts";
import type { Shape } from "../src/annotations/shapes.ts";

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
    assert.ok(typed !== null);
    const doc = typed(accepted.document);
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

  it("keeps the class the expert chose and fills a missing one only for a known class", async () => {
    const chosen = acceptedSmartRun("area2-tumor");
    const typed = await typeAccepted("slide-1", chosen.document, chosen.shapes, fakeServer);
    const doc = typed?.(chosen.document);
    assert.ok(doc !== undefined);
    for (const shape of chosen.shapes)
      assert.equal(getShape(doc, shape.id)?.classKey, "area2-tumor");

    const blank = acceptedSmartRun();
    const known = (key: string) => key === "tumor";
    const filled = await typeAccepted("slide-1", blank.document, blank.shapes, fakeServer, known);
    const next = filled?.(blank.document);
    assert.ok(next !== undefined);
    assert.deepEqual(
      blank.shapes.map((shape) => getShape(next, shape.id)?.classKey),
      ["tumor", null, null, null],
    );
  });

  it("accepts untyped when the typer is offline", async () => {
    const accepted = acceptedSmartRun("area2-tumor");
    assert.equal(accepted.shapes.length, 4);
    const typed = await typeAccepted("slide-1", accepted.document, accepted.shapes, offline);
    assert.equal(typed, null);
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
    assert.equal(
      await typeAccepted("slide-1", accepted.document, accepted.shapes, fakeServer),
      null,
    );

    const smart = acceptedSmartRun();
    const short = toOutlineTypes("slide-1", [{ points: Array.from(square(16, 16)) }]);
    assert.equal(withTypings(smart.document, smart.shapes, short), smart.document);
  });
});
