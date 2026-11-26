import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Thread } from "@parfocal/api-client";
import type { Reach } from "../src/annotations/comment-bus.ts";
import { linkParts } from "../src/annotations/comment-link-parts.ts";
import { anchorReferences } from "../src/annotations/pin-references.ts";
import { plainReferenceText } from "../src/annotations/reference-token-parse.ts";
import { toReferenceTokens } from "../src/annotations/reference-tokens.ts";
import {
  findResult,
  lookupResultAt,
  publishResultLookup,
} from "../src/annotations/result-objects.ts";

const box = (left: number, top: number, right: number, bottom: number): Thread["anchor"] => ({
  kind: "shape",
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [left, top],
        [right, top],
        [right, bottom],
        [left, bottom],
        [left, top],
      ],
    ],
  },
});

const region = (id: string, anchor: Thread["anchor"], at: string): Thread =>
  ({ id, anchor, created_at: at }) as Thread;

const first = region("a", box(10, 10, 50, 40), "2026-11-01T10:00:00Z");
const second = region("b", box(300, 200, 420, 260), "2026-11-01T11:00:00Z");
const slideId = "00000000-0000-4000-8005-000000000001";

function reached(text: string) {
  const got: Reach[] = [];
  const parts = linkParts(text, [], (target) => got.push(target));
  for (const part of parts) if (typeof part !== "string") part.reach();
  return { parts, got };
}

describe("region and slide names saved as tokens", () => {
  test("a writer's region name keeps pointing at the same area for a reader who sees fewer regions", () => {
    const writer = anchorReferences([first, second]);
    const reader = anchorReferences([second]);
    assert.equal(writer[1]?.text, "#Region 2");
    assert.equal(reader[0]?.text, "#Region 1");
    const body = toReferenceTokens("Compare #Region 2 with this", writer);
    assert.equal(body, "Compare #[#Region 2|area:300,200,420,260] with this");
    const { parts, got } = reached(body);
    assert.deepEqual(
      parts.map((part) => (typeof part === "string" ? part : part.text)),
      ["Compare ", "#Region 2", " with this"],
    );
    assert.deepEqual(got, [{ kind: "anchor", anchor: box(300, 200, 420, 260) }]);
    const plain = linkParts("Compare #Region 1", [], () => undefined, reader);
    assert.equal(typeof plain[1] === "string" ? "" : plain[1]?.text, "#Region 1");
  });

  test("a slide name is saved with its ID and tokens are not nested or split", () => {
    const slides = [{ text: "A1", reach: { kind: "slide", slideId } as const }];
    const body = toReferenceTokens(`See A1 and A1x, @[${slideId}]`, slides);
    assert.equal(body, `See #[A1|slide:${slideId}] and A1x, @[${slideId}]`);
    assert.equal(toReferenceTokens(body, slides), body);
    assert.deepEqual(reached(body).got, [{ kind: "slide", slideId }]);
    assert.equal(plainReferenceText(body), `See A1 and A1x, @[${slideId}]`);
  });

  test("a selection is saved as the box around its objects", () => {
    const selection = region(
      "c",
      {
        kind: "shape",
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [5, 5],
                [9, 5],
                [9, 9],
                [5, 5],
              ],
            ],
            [
              [
                [40, 30],
                [60, 30],
                [60, 70],
                [40, 30],
              ],
            ],
          ],
        },
      },
      "2026-11-01T12:00:00Z",
    );
    const listed = anchorReferences([selection]);
    assert.equal(listed[0]?.text, "#Selection 1");
    assert.equal(
      toReferenceTokens("Both of #Selection 1", listed),
      "Both of #[#Selection 1|area:5,5,60,70]",
    );
  });

  test("a broken token shows its name without a link", () => {
    const { parts, got } = reached("Look at #[#Region 3|area:1,2] here");
    assert.deepEqual(parts, ["Look at ", "#Region 3", " here"]);
    assert.equal(got.length, 0);
  });
});

describe("AI cells found by a lookup", () => {
  test("a published lookup answers clicks and the result set picks between equal IDs", () => {
    const cell = { id: "C5", ring: [0, 0, 4, 0, 4, 4], set: "s1" };
    publishResultLookup("slide", "cells:s1", (at) => (at.x < 10 ? cell : null));
    assert.equal(lookupResultAt("slide", { x: 2, y: 2 }, 1)?.id, "C5");
    assert.equal(lookupResultAt("slide", { x: 20, y: 2 }, 1), null);
    publishResultLookup("slide", "cells:s1", null);
    assert.equal(lookupResultAt("slide", { x: 2, y: 2 }, 1), null);
    const other = { ...cell, set: "s2", ring: [9, 9, 9, 9] };
    assert.equal(findResult([cell, other], "C5", "s2"), other);
    assert.equal(findResult([cell, other], "C5"), cell);
  });
});
