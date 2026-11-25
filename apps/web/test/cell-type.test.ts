import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cellTypeText, shapeColour } from "../src/annotations/cell-type.ts";
import type { OutlineTyping, Shape } from "../src/annotations/shapes.ts";

const typing: OutlineTyping = {
  typer: "pathosam-hovernext",
  version: "v1.2",
  probabilities: { tumor: 0.82, stroma: 0.1, immune: 0.04, other: 0.04 },
  type: "tumor",
  alternatives: [],
  foreground: 0.9,
  mayNotBeNucleus: false,
};

const cell = (classKey: string | null, typed: OutlineTyping | undefined): Shape =>
  ({
    id: 1,
    kind: "polygon",
    classKey,
    provenance: {
      kind: "model",
      runId: 1,
      piece: 0,
      confidence: 0.9,
      edited: false,
      ...(typed === undefined ? {} : { typing: typed }),
    },
  }) as unknown as Shape;

const colours: Record<string, string> = { "class-tumor": "#f87171", "class-stroma": "#6ee7b7" };
const classColour = (key: string | null) => (key === null ? null : (colours[key] ?? null));
const names: Record<string, string> = { "class-tumor": "Tumor", "class-stroma": "Stroma" };
const className = (key: string) => names[key] ?? null;

describe("cell type colour and text", () => {
  it("draws a cell in its class colour", () => {
    assert.equal(shapeColour(cell("class-stroma", typing), classColour), "#6ee7b7");
  });

  it("draws a typed cell without a project class in the type's own colour", () => {
    assert.match(shapeColour(cell(null, typing), classColour) ?? "", /^#[0-9a-f]{6}$/);
  });

  it("leaves an untyped cell with no class to the selection colour", () => {
    assert.equal(shapeColour(cell(null, undefined), classColour), null);
  });

  it("names the class and the typer's confidence", () => {
    assert.deepEqual(cellTypeText(cell("class-tumor", typing), className), {
      name: "Tumor",
      typed: { type: "tumor", percent: 82 },
      changed: false,
    });
  });

  it("marks a type the reviewer changed away from the typer's answer", () => {
    assert.equal(cellTypeText(cell("class-stroma", typing), className)?.changed, true);
    assert.equal(cellTypeText(cell(null, undefined), className), null);
  });
});
