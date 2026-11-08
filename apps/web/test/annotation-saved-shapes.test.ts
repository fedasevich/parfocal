import assert from "node:assert/strict";
import { after, afterEach, before, describe, test } from "node:test";
import { type AnnotationDraft, listAnnotations } from "@parfocal/api-client";
import { fakeApiHandlers, resetFakeAnnotations } from "@parfocal/api-client/fake";
import { setupServer } from "msw/node";
import { adoptTheirs } from "../src/annotations/conflicts.ts";
import {
  type AnnotationDocument,
  addShape,
  createDocument,
  type NewShape,
  updateShape,
} from "../src/annotations/document.ts";
import { createSaveQueue, type Remote, type SaveQueue } from "../src/annotations/save-queue.ts";
import { annotationTransport, editOf } from "../src/annotations/save-transport.ts";
import { draftOf, sameBody, shapeOf } from "../src/annotations/saved-shapes.ts";
import type { Shape } from "../src/annotations/shapes.ts";

const server = setupServer(...fakeApiHandlers("all"));
let patchedFetch: typeof fetch;

before(() => {
  server.listen({ onUnhandledFrame: "error" });
  patchedFetch = globalThis.fetch;
  globalThis.fetch = (input, init) =>
    patchedFetch(new URL(input instanceof Request ? input.url : input, "http://app.test"), init);
});

afterEach(() => resetFakeAnnotations());

after(() => {
  globalThis.fetch = patchedFetch;
  server.close();
});

const slideId = "slide-marks";

const made = (input: NewShape): { doc: AnnotationDocument; shape: Shape } => {
  const added = addShape(createDocument(), input);
  return { doc: added.document, shape: added.shape };
};

const ruler = made({ kind: "ruler", points: Float32Array.of(10, 20, 310, 420) });
const arrow = made({ kind: "arrow", points: Float32Array.of(50, 60, 150, 90) });
const note = made({ kind: "text", points: Float32Array.of(70, 80), text: "Mitosis here" });

const kinds = [
  {
    name: "A ruler",
    saved: "measurement",
    start: ruler,
    edit: (doc: AnnotationDocument, shape: Shape) =>
      updateShape(doc, shape.id, {
        geometry: { points: Float32Array.of(10, 20, 40, 60), ringStarts: shape.ringStarts },
      }).shape,
  },
  {
    name: "An arrow",
    saved: "arrow",
    start: arrow,
    edit: (doc: AnnotationDocument, shape: Shape) =>
      updateShape(doc, shape.id, {
        geometry: { points: Float32Array.of(150, 90, 50, 60), ringStarts: shape.ringStarts },
      }).shape,
  },
  {
    name: "A text note",
    saved: "text",
    start: note,
    edit: (doc: AnnotationDocument, shape: Shape) =>
      updateShape(doc, shape.id, { text: "Two mitoses" }).shape,
  },
] as const;

const drained = (queue: SaveQueue<AnnotationDraft>) =>
  new Promise<void>((resolve) => {
    const check = () => {
      const { phase, waiting } = queue.status();
      if (waiting === 0 && phase !== "saving" && phase !== "retrying") {
        stop();
        resolve();
      }
    };
    const stop = queue.subscribe(check);
    queue.flushNow();
    check();
  });

const reload = async (): Promise<Shape[]> => {
  const listed = await listAnnotations(slideId);
  assert.equal(listed.status, 200);
  let doc = createDocument();
  for (const record of listed.data) {
    const input = shapeOf(record);
    if (input !== null) doc = addShape(doc, input).document;
  }
  return [...doc.shapes.values()];
};

const bodyOf = (shape: Shape): AnnotationDraft => {
  const draft = draftOf(shape);
  assert.ok(draft, `${shape.kind} has a saved form`);
  return draft;
};

describe("rulers, arrows and text notes through the save queue", () => {
  for (const kind of kinds) {
    test(`${kind.name} is created, edited, reloaded and deleted`, async () => {
      const queue = createSaveQueue(annotationTransport(slideId), { batchMs: 0 });
      const remote: Remote = { id: null, version: 1 };
      const first = kind.start.shape;
      assert.equal(bodyOf(first).kind, kind.saved);

      queue.enqueueCreate(remote, bodyOf(first));
      await drained(queue);
      assert.equal(queue.status().phase, "saved");
      const [loaded] = await reload();
      assert.ok(loaded);
      assert.equal(loaded.kind, first.kind);
      assert.deepEqual([...loaded.points], [...first.points]);
      assert.equal(loaded.text, first.text);

      const changed = kind.edit(kind.start.doc, first);
      assert.equal(sameBody(first, changed), false);
      queue.enqueueUpdate(remote, bodyOf(changed));
      await drained(queue);
      assert.equal(remote.version, 2);
      const [edited] = await reload();
      assert.ok(edited);
      assert.deepEqual([...edited.points], [...changed.points]);
      assert.equal(edited.text, changed.text);

      queue.enqueueRemove(remote);
      await drained(queue);
      assert.deepEqual(await reload(), []);
    });
  }
});

describe("saved forms of marks", () => {
  test("a text edit counts as a change and a moved copy with the same words does not", () => {
    const words = updateShape(note.doc, note.shape.id, { text: "Other words" }).shape;
    assert.equal(sameBody(note.shape, words), false);
    assert.equal(sameBody(note.shape, { ...note.shape }), true);
  });

  test("only a text note sends its words in an edit", () => {
    assert.deepEqual(editOf(3, bodyOf(note.shape)), {
      version: 3,
      geometry: { type: "Point", coordinates: [70, 80] },
      text: "Mitosis here",
    });
    assert.equal("text" in editOf(3, bodyOf(arrow.shape)), false);
    assert.equal("text" in editOf(3, bodyOf(ruler.shape)), false);
  });

  test("area measurements, regions of interest and text without words are not loaded", () => {
    const ring = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [5, 0],
          [5, 5],
          [0, 0],
        ],
      ],
    };
    assert.equal(shapeOf({ kind: "measurement", geometry: ring }), null);
    assert.equal(shapeOf({ kind: "roi", geometry: ring }), null);
    assert.equal(
      shapeOf({ kind: "text", geometry: { type: "Point", coordinates: [1, 2] }, text: " " }),
      null,
    );
  });

  test("taking a colleague's text note keeps their words", () => {
    const adopted = adoptTheirs(createDocument(), null, {
      version: 2,
      deleted: false,
      geometry: { type: "Point", coordinates: [4, 5] },
      classId: null,
      changedBy: "u-2",
      kind: "text",
      text: "Their note",
    });
    const shape =
      adopted.shapeId === null ? undefined : adopted.document.shapes.get(adopted.shapeId);
    assert.equal(shape?.kind, "text");
    assert.equal(shape?.text, "Their note");
  });
});

test("a polygon always sends its class, so clearing the class clears it on the server", () => {
  const classed = made({
    kind: "polygon",
    points: Float32Array.of(0, 0, 10, 0, 10, 10),
    classKey: "c1",
  });
  const cleared = made({ kind: "polygon", points: Float32Array.of(0, 0, 10, 0, 10, 10) });
  assert.equal(draftOf(classed.shape)?.class_id, "c1");
  const body = draftOf(cleared.shape);
  assert.ok(body);
  assert.equal(body.class_id, null);
  assert.equal(editOf(2, body).class_id, null);
  assert.ok("class_id" in editOf(2, body));
  const loaded = shapeOf({ kind: "region", geometry: { ...body.geometry }, class_id: "c2" });
  assert.equal(loaded?.kind === "polygon" ? loaded.classKey : undefined, "c2");
});
