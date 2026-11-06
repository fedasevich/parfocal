import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type AnnotationDocument,
  addGroup,
  addRestoredShape,
  addShape,
  createDocument,
  groupChain,
  linkThread,
  listShapes,
  placePin,
} from "../src/annotations/document.ts";
import { createHistory, undo } from "../src/annotations/history.ts";
import {
  importFile,
  mergeFile,
  readFile,
  toGeoJson,
  toOwnJson,
  UnreadableFileError,
} from "../src/annotations/interchange.ts";

function drawn(): AnnotationDocument {
  const tissue = addGroup(createDocument(), "Tissue", { color: [10, 20, 30], locked: true });
  const tumour = addGroup(tissue.document, "Tumour", { parentId: tissue.group.id, hidden: true });
  let doc = tumour.document;
  doc = addShape(doc, {
    kind: "polygon",
    points: Float32Array.of(0, 0, 10.25, 0, 10, 10.5),
    classKey: "Tumor",
    groupId: tumour.group.id,
    reviewState: "agreed",
  }).document;
  doc = addShape(doc, {
    kind: "rectangle",
    points: Float32Array.of(5, 5, 25, 15),
    groupId: tissue.group.id,
    reviewState: "unsure",
  }).document;
  doc = addShape(doc, { kind: "ellipse", points: Float32Array.of(1, 1, 9, 5) }).document;
  doc = addShape(doc, {
    kind: "point",
    points: Float32Array.of(3, 4),
    classKey: "Stroma",
  }).document;
  doc = addShape(doc, { kind: "ruler", points: Float32Array.of(0, 0, 30, 40) }).document;
  doc = addShape(doc, { kind: "arrow", points: Float32Array.of(1, 2, 3, 4) }).document;
  doc = addShape(doc, { kind: "text", points: Float32Array.of(7, 7), text: "Look here" }).document;
  doc = addShape(doc, {
    kind: "brush",
    points: Float32Array.of(0, 0, 4, 0, 4, 4, 10, 10, 14, 10, 14, 14),
    ringStarts: Uint32Array.of(0, 3, 6),
    reviewState: "disagreed",
  }).document;
  doc = addRestoredShape(
    doc,
    { kind: "freehand", points: Float32Array.of(0, 0, 2, 0, 2, 2, 0, 2) },
    {
      kind: "model",
      model: "HoVer-NeXt",
      version: "1.2",
      runId: 4,
      piece: 9,
      confidence: 0.75,
      edited: true,
    },
    [],
  ).document;
  doc = linkThread(doc, 1, "thread-a").document;
  doc = linkThread(doc, 1, "thread-b").document;
  doc = placePin(doc, "thread-a", { shapeId: 1, offset: { x: 2, y: -3 } });
  doc = placePin(doc, "thread-c", { shapeId: null, offset: { x: 40, y: 50 } });
  return doc;
}

function described(doc: AnnotationDocument, under: number | null): unknown {
  const pathOf = (groupId: number | null) =>
    groupChain(doc, groupId)
      .filter((group) => group.id !== under)
      .map((group) => [group.name, group.color, group.hidden, group.locked]);
  const order = listShapes(doc).map((shape) => shape.id);
  return {
    shapes: listShapes(doc).map((shape) => ({
      kind: shape.kind,
      points: Array.from(shape.points),
      ringStarts: Array.from(shape.ringStarts),
      classKey: shape.classKey,
      group: pathOf(shape.groupId),
      text: shape.text,
      reviewState: shape.reviewState,
      threadIds: shape.threadIds,
      provenance: shape.provenance,
    })),
    pins: [...doc.pins.entries()].map(([thread, pin]) => [
      thread,
      pin.shapeId === null ? null : order.indexOf(pin.shapeId),
      pin.offset,
    ]),
  };
}

describe("annotation import and export", () => {
  for (const [name, write] of [
    ["own JSON", toOwnJson],
    ["GeoJSON", toGeoJson],
  ] as const) {
    test(`${name} exports and re-imports with no loss`, () => {
      const original = drawn();
      const text = JSON.stringify(write(original));
      const merged = mergeFile(createDocument(), readFile(text), "slide-1.json");
      assert.deepEqual(merged.skipped, []);
      assert.equal(merged.added.length, original.shapes.size);
      assert.deepEqual(described(merged.document, merged.group.id), described(original, null));
      const again = mergeFile(
        createDocument(),
        readFile(JSON.stringify(write(merged.document))),
        "x",
      );
      assert.deepEqual(described(again.document, again.group.id), described(merged.document, null));
    });
  }

  test("an import merges into a new group named after the file and keeps what was there", () => {
    const before = addShape(createDocument(), {
      kind: "point",
      points: Float32Array.of(1, 1),
    }).document;
    const merged = mergeFile(before, readFile(JSON.stringify(toOwnJson(drawn()))), "case.json");
    assert.equal(merged.document.shapes.size, 1 + drawn().shapes.size);
    assert.equal(merged.group.name, "case.json");
    assert.equal(merged.group.parentId, null);
    assert.ok(merged.document.shapes.get(1));
    assert.equal(merged.document.shapes.get(1)?.groupId, null);
    for (const id of merged.added) {
      const chain = groupChain(merged.document, merged.document.shapes.get(id)?.groupId ?? null);
      assert.equal(chain.at(-1)?.id, merged.group.id);
    }
  });

  test("one undo takes the whole import back", () => {
    const before = addShape(createDocument(), {
      kind: "point",
      points: Float32Array.of(1, 1),
    }).document;
    const text = JSON.stringify(toGeoJson(drawn()));
    const imported = importFile(before, createHistory(), text, "case.geojson");
    assert.notEqual(imported.document, before);
    const back = undo(imported.history);
    assert.equal(back?.document, before);
    assert.equal(back?.label, "Import case.geojson");
  });

  test("a QuPath file reads classes, holes, points and lines and lists what it skipped", () => {
    const qupath = [
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [10, 0],
              [10, 10],
              [0, 0],
            ],
          ],
        },
        properties: { objectType: "annotation", classification: { name: "Tumor" } },
      },
      {
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [0, 0],
              [20, 0],
              [20, 20],
              [0, 20],
              [0, 0],
            ],
            [
              [5, 5],
              [6, 5],
              [6, 6],
              [5, 5],
            ],
          ],
        },
        properties: { objectType: "annotation" },
      },
      {
        type: "Feature",
        geometry: {
          type: "MultiPoint",
          coordinates: [
            [1, 2],
            [3, 4],
          ],
        },
        properties: {},
      },
      {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [0, 0],
            [5, 5],
          ],
        },
        properties: {},
      },
      { type: "Feature", geometry: null, properties: {} },
    ];
    const merged = mergeFile(createDocument(), readFile(JSON.stringify(qupath)), "qupath.geojson");
    assert.deepEqual(
      listShapes(merged.document).map((shape) => [shape.kind, shape.classKey]),
      [
        ["polygon", "Tumor"],
        ["brush", null],
        ["point", null],
        ["point", null],
        ["ruler", null],
      ],
    );
    assert.deepEqual(
      Array.from(listShapes(merged.document)[0]?.points ?? []),
      [0, 0, 10, 0, 10, 10],
    );
    assert.deepEqual(merged.skipped, [{ index: 4, reason: "It has no geometry" }]);
  });

  test("the run export of a slide reads into a new group", () => {
    const run = {
      format: "parfocal-results",
      version: 1,
      objects: [
        {
          kind: "region",
          class: "Tumor",
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [4, 0],
                [4, 4],
                [0, 0],
              ],
            ],
          },
        },
      ],
    };
    const merged = mergeFile(createDocument(), readFile(JSON.stringify(run)), "run.json");
    assert.deepEqual(
      listShapes(merged.document).map((shape) => [shape.kind, shape.classKey, shape.groupId]),
      [["polygon", "Tumor", merged.group.id]],
    );
  });

  test("a file that is neither GeoJSON nor an export is refused", () => {
    assert.throws(() => readFile("not json"), UnreadableFileError);
    assert.throws(() => readFile('{"hello":"world"}'), UnreadableFileError);
    const empty = readFile('{"type":"FeatureCollection","features":[]}');
    assert.throws(() => mergeFile(createDocument(), empty, "empty.geojson"), UnreadableFileError);
  });
});
