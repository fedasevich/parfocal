import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Thread } from "@parfocal/api-client";
import { anchorArea } from "../src/annotations/anchor-place.ts";
import { onReach, reachMention } from "../src/annotations/comment-bus.ts";
import { linkParts } from "../src/annotations/comment-link-parts.ts";
import {
  publishReferences,
  referenceList,
  referenceQuery,
  withReference,
} from "../src/annotations/comment-references.ts";
import { objectAnchor, targetExtent } from "../src/annotations/comment-target.ts";
import { createDocument } from "../src/annotations/document.ts";
import { spacedMarks } from "../src/annotations/mark-spacing.ts";
import { anchorReferences } from "../src/annotations/pin-references.ts";
import { findResult, resultAt, resultFor, ringExtent } from "../src/annotations/result-objects.ts";
import { linkToObject } from "../src/shell/notification-links.ts";

const cell = { id: "C2", ring: [514, 295, 525, 294, 527, 304, 519, 307, 513, 302] };
const region = { id: "T1", ring: [140, 150, 330, 130, 380, 250, 300, 340, 160, 320] };
const inner = { id: "T1·C145", ring: [250, 240, 256, 240, 256, 246, 250, 246] };

const thread = (id: string, anchor: Thread["anchor"], at: string): Thread =>
  ({ id, anchor, created_at: at }) as Thread;

describe("AI result objects on the slide", () => {
  test("a click finds the smallest object under it and a near click finds a small cell", () => {
    const list = [region, cell, inner];
    assert.equal(resultAt(list, { x: 520, y: 300 }, 4)?.id, "C2");
    assert.equal(resultAt(list, { x: 529, y: 300 }, 8)?.id, "C2");
    assert.equal(resultAt(list, { x: 529, y: 300 }, 4), null);
    assert.equal(resultAt(list, { x: 253, y: 243 }, 4)?.id, "T1·C145");
    assert.equal(resultAt(list, { x: 200, y: 200 }, 4)?.id, "T1");
    assert.equal(resultAt(list, { x: 900, y: 900 }, 4), null);
  });

  test("an object is found by either ID form and placed by its outline", () => {
    assert.equal(findResult([inner], "T1.C145")?.id, "T1·C145");
    assert.deepEqual(ringExtent(cell.ring), [513, 294, 527, 307]);
    const place = { doc: createDocument(), codes: undefined, areas: [], results: [inner] };
    assert.deepEqual(anchorArea({ kind: "object", object_id: "T1.C145" }, place), {
      x: 250,
      y: 240,
      width: 6,
      height: 6,
    });
  });

  test("an object without an outline falls back to its slide area", () => {
    const areas = [{ object: "T2", size: null, bounds: { x: 10, y: 20, width: 30, height: 40 } }];
    assert.equal(resultFor([cell], areas, "C2")?.id, "C2");
    assert.deepEqual(resultFor([cell], areas, "T2")?.ring, [10, 20, 40, 20, 40, 60, 10, 60]);
    assert.equal(resultFor([cell], areas, "T9"), undefined);
  });

  test("an object target without shapes keeps its extent and anchors to its ASCII ID", () => {
    const extent = [1, 2, 3, 4] as const;
    assert.deepEqual(
      targetExtent(createDocument(), { kind: "object", objectId: "C2", shapes: [], extent }),
      extent,
    );
    assert.deepEqual(objectAnchor("T1·C145"), { kind: "object", object_id: "T1.C145" });
    assert.deepEqual(objectAnchor("R2"), { kind: "roi", object_id: "R2" });
  });
});

describe("what a comment names", () => {
  test("regions, selections and slide names become links next to object IDs", () => {
    const reached: unknown[] = [];
    const box: Thread["anchor"] = {
      kind: "shape",
      geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
    };
    const parts = linkParts(
      "See #Region 1 on tumor_044 and C2",
      [],
      (target) => reached.push(target),
      [
        { text: "#Region 1", reach: { kind: "anchor", anchor: box } },
        { text: "tumor_044", reach: { kind: "slide", slideId: "s1" } },
      ],
    );
    const links = parts.filter((part) => typeof part !== "string");
    assert.deepEqual(
      links.map((part) => part.text),
      ["#Region 1", "tumor_044", "C2"],
    );
    for (const link of links) link.reach();
    assert.deepEqual(reached, [
      { kind: "anchor", anchor: box },
      { kind: "slide", slideId: "s1" },
      { kind: "object", id: "C2" },
    ]);
    const slides: unknown[] = [];
    const named = linkParts("A2 next to T1·C145 and T1.", [], (target) => slides.push(target), [
      { text: "A2", reach: { kind: "slide", slideId: "s2" } },
      { text: "T1", reach: { kind: "object", id: "T1" } },
    ]);
    const namedLinks = named.filter((part) => typeof part !== "string");
    assert.deepEqual(
      namedLinks.map((part) => part.text),
      ["A2", "T1·C145", "T1"],
    );
    for (const link of namedLinks) link.reach();
    assert.deepEqual(slides, [
      { kind: "slide", slideId: "s2" },
      { kind: "object", id: "T1·C145" },
      { kind: "object", id: "T1" },
    ]);
    assert.deepEqual(
      linkParts("tumor_0445 stays text", [], () => undefined, [
        { text: "tumor_044", reach: { kind: "slide", slideId: "s1" } },
      ]),
      ["tumor_0445 stays text"],
    );
  });

  test("region and selection threads are numbered in the order they were started", () => {
    const box: Thread["anchor"] = {
      kind: "shape",
      geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
    };
    const many: Thread["anchor"] = {
      kind: "shape",
      geometry: { type: "MultiPolygon", coordinates: [[[[0, 0]]], [[[1, 1]]]] },
    };
    const refs = anchorReferences([
      thread("b", box, "2026-11-26T10:00:00Z"),
      thread("a", box, "2026-11-26T09:00:00Z"),
      thread("c", many, "2026-11-26T11:00:00Z"),
      thread("d", { kind: "point" }, "2026-11-26T12:00:00Z"),
    ]);
    assert.deepEqual(
      refs.map((ref) => [ref.id, ref.text, ref.sub]),
      [
        ["a", "#Region 1", "Area"],
        ["b", "#Region 2", "Area"],
        ["c", "#Selection 1", "2 objects"],
      ],
    );
  });

  test("the # list reads its query and inserts the picked name", () => {
    assert.equal(referenceQuery("look at #Reg"), "Reg");
    assert.equal(referenceQuery("no list here"), undefined);
    assert.equal(withReference("look at #Reg", { text: "#Region 1" }), "look at #Region 1 ");
  });

  test("published references are listed once per name and leave with their source", () => {
    const reach = { kind: "object" as const, id: "C2" };
    publishReferences("one", [{ id: "C2", text: "C2", sub: "Cell", reach }]);
    publishReferences("two", [{ id: "C2", text: "C2", sub: "Object", reach }]);
    assert.equal(referenceList().length, 1);
    publishReferences("one", []);
    publishReferences("two", []);
    assert.equal(referenceList().length, 0);
  });
});

describe("the comment bus", () => {
  test("a reach for one slide does not reach a stage on another", () => {
    const left: unknown[] = [];
    const right: unknown[] = [];
    const stopLeft = onReach("left", (target) => left.push(target));
    const stopRight = onReach("right", (target) => right.push(target));
    reachMention({ kind: "object", id: "C2" }, "left");
    reachMention({ kind: "object", id: "C3" });
    stopLeft();
    stopRight();
    assert.deepEqual(left, [
      { kind: "object", id: "C2" },
      { kind: "object", id: "C3" },
    ]);
    assert.deepEqual(right, [{ kind: "object", id: "C3" }]);
  });
});

describe("comment marks on the slide", () => {
  test("a mark that would cover another one moves beside it", () => {
    const kept = spacedMarks([
      { id: "a", at: { x: 100, y: 100 } },
      { id: "b", at: { x: 110, y: 104 } },
      { id: "c", at: { x: 140, y: 100 } },
    ]);
    assert.deepEqual(
      kept.map((mark) => [mark.id, mark.at.x]),
      [
        ["a", 100],
        ["b", 136],
        ["c", 166],
      ],
    );
  });
});

describe("links in notifications", () => {
  test("a mentioned object opens the notification's slide at that object", () => {
    assert.equal(
      linkToObject("/projects/p/slides/s?task=t&object=C1", "C2"),
      "/projects/p/slides/s?task=t&object=C2",
    );
    assert.equal(linkToObject("/my-work", "C2"), "/my-work");
    assert.equal(
      linkToObject("https://elsewhere.example/slides/x", "C2"),
      "https://elsewhere.example/slides/x",
    );
  });
});
