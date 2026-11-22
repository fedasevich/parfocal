import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addRestoredShape,
  addShape,
  createDocument,
  type NewShape,
} from "../src/annotations/document.ts";
import { drawnObjectIds } from "../src/annotations/drawn-object-ids.ts";
import { toGeoJson, toOwnJson } from "../src/annotations/interchange.ts";

const square: NewShape = { kind: "polygon", points: Float32Array.of(0, 0, 10, 0, 10, 10, 0, 10) };

const withShapes = (shapes: readonly NewShape[]) =>
  shapes.reduce((doc, shape) => addShape(doc, shape).document, createDocument());

const shownOf = (shapes: readonly NewShape[]) =>
  [...drawnObjectIds(withShapes(shapes)).values()].map((id) => id.shown);

describe("ids of drawn shapes", () => {
  test("a drawn region takes T and the person mark", () => {
    assert.deepEqual(shownOf([square, { ...square, kind: "freehand" }]), ["T1⁺", "T2⁺"]);
  });

  test("a drawn nucleus outline and a marker take C and the person mark", () => {
    const typing = {
      typer: "t",
      version: "1",
      probabilities: {},
      type: "Tumor",
      alternatives: [],
      foreground: 1,
      mayNotBeNucleus: false,
    };
    const outline = addRestoredShape(
      createDocument(),
      square,
      {
        kind: "model",
        model: "smart",
        version: null,
        runId: 1,
        piece: 0,
        confidence: null,
        edited: false,
        typing,
      },
      [],
    );
    const doc = addShape(outline.document, {
      kind: "point",
      points: Float32Array.of(1, 1),
    }).document;
    assert.deepEqual(
      [...drawnObjectIds(doc).values()].map((id) => id.shown),
      ["C1⁺", "C2⁺"],
    );
  });

  test("a ruler keeps M with no mark and each letter counts on its own", () => {
    const ruler: NewShape = { kind: "ruler", points: Float32Array.of(0, 0, 5, 0) };
    assert.deepEqual(shownOf([ruler, square, ruler]), ["M1", "T1⁺", "M2"]);
  });

  test("arrows get no object ID", () => {
    const arrow: NewShape = { kind: "arrow", points: Float32Array.of(0, 0, 5, 0) };
    assert.deepEqual(shownOf([arrow]), []);
  });

  test("an export writes the ASCII form T7+", () => {
    const doc = withShapes(Array.from({ length: 7 }, () => square));
    const objects = toOwnJson(doc)["objects"] as { object_id: string }[];
    assert.equal(objects[6]?.object_id, "T7+");
    const features = toGeoJson(doc)["features"] as {
      properties: { parfocal: { object_id: string } };
    }[];
    assert.equal(features[6]?.properties.parfocal.object_id, "T7+");
  });
});
