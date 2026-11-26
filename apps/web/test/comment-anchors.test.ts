import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { anchorArea, anchorRowKey, anchorShapes } from "../src/annotations/anchor-place.ts";
import { anchorWords } from "../src/annotations/anchor-words.ts";
import { linkParts } from "../src/annotations/comment-link-parts.ts";
import { regionTarget, targetOfShapes, targetThread } from "../src/annotations/comment-target.ts";
import { addShape, createDocument } from "../src/annotations/document.ts";

const square = (x: number) => new Float32Array([x, 0, x + 100, 0, x + 100, 100, x, 100]);

function drawn() {
  const one = addShape(createDocument(), { kind: "polygon", points: square(0) });
  const two = addShape(one.document, { kind: "polygon", points: square(300) });
  const codes = new Map([
    [one.shape.id, "T7+"],
    [two.shape.id, "T8+"],
  ]);
  return { doc: two.document, codes, ids: [one.shape.id, two.shape.id] as const };
}

const noName = () => undefined;

describe("what a comment attaches to", () => {
  test("one coded shape is an object anchor by its ID", () => {
    const { doc, codes, ids } = drawn();
    const target = targetOfShapes(doc, codes, [ids[0]]);
    assert.equal(target?.kind, "object");
    const thread = target === null ? null : targetThread(target, "Is this tumour?");
    assert.deepEqual(thread?.anchor, { kind: "object", object_id: "T7+" });
  });

  test("several shapes are one selection and a drag is a region", () => {
    const { doc, codes, ids } = drawn();
    const selection = targetOfShapes(doc, codes, ids);
    assert.equal(selection?.kind, "selection");
    const anchor = selection === null ? null : targetThread(selection, "These")?.anchor;
    assert.equal(anchor?.kind, "shape");
    assert.equal(anchor?.geometry?.type, "MultiPolygon");
    const region = targetThread(regionTarget({ x: 50, y: 60 }, { x: 10, y: 20 }), "Here");
    assert.deepEqual(region?.anchor.geometry, {
      type: "Polygon",
      coordinates: [
        [
          [10, 20],
          [50, 20],
          [50, 60],
          [10, 60],
          [10, 20],
        ],
      ],
    });
  });

  test("an empty comment makes no thread", () => {
    assert.equal(targetThread({ kind: "layer", layer: "g:1", name: "Tumor" }, "  "), null);
  });
});

describe("the words a thread is listed under", () => {
  test("each kind reads as what it is, never Pin Pin", () => {
    const point = {
      kind: "point" as const,
      geometry: { type: "Point" as const, coordinates: [1, 2] as [number, number] },
    };
    assert.deepEqual(anchorWords(point, noName), { label: "Pin", kind: "Point" });
    assert.deepEqual(anchorWords({ kind: "object", object_id: "T170+" }, noName), {
      label: "T170⁺",
      kind: "Drawn region",
    });
    assert.deepEqual(anchorWords({ kind: "object", object_id: "T2.C145" }, noName), {
      label: "T2·C145",
      kind: "Cell",
    });
    assert.deepEqual(
      anchorWords({ kind: "layer", layer: "g:3" }, () => "Margins"),
      {
        label: "Margins",
        kind: "Group",
      },
    );
    assert.equal(anchorWords({ kind: "layer", layer: "c:tumour" }, noName).kind, "Class layer");
  });
});

describe("reaching an anchor", () => {
  test("an object ID finds its shape and a layer finds its members", () => {
    const { doc, codes, ids } = drawn();
    const place = { doc, codes, areas: [] };
    assert.deepEqual(anchorShapes({ kind: "object", object_id: "T8⁺" }, place), [ids[1]]);
    assert.equal(anchorRowKey({ kind: "object", object_id: "T7+" }, place), `s:${ids[0]}`);
    assert.deepEqual(anchorArea({ kind: "object", object_id: "T8+" }, place), {
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    });
    assert.equal(anchorArea({ kind: "layer", layer: "g:99" }, place), null);
  });
});

describe("links in a comment", () => {
  test("object IDs and named layers become links that reach them", () => {
    const reached: unknown[] = [];
    const parts = linkParts(
      "Compare T2·C145 with #Tumor margin and T7+ please",
      [{ key: "g:4", name: "Tumor margin" }],
      (target) => reached.push(target),
    );
    const links = parts.filter((part) => typeof part !== "string");
    assert.deepEqual(
      links.map((part) => part.text),
      ["T2·C145", "#Tumor margin", "T7+"],
    );
    for (const link of links) link.reach();
    assert.deepEqual(reached, [
      { kind: "object", id: "T2·C145" },
      { kind: "layer", key: "g:4" },
      { kind: "object", id: "T7+" },
    ]);
    assert.deepEqual(
      linkParts("No ids, CT scan or T cells", [], () => undefined),
      ["No ids, CT scan or T cells"],
    );
  });
});
