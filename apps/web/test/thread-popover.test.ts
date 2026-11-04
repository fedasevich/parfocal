import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  addGroup,
  addShape,
  createDocument,
  linkThread,
  updateGroup,
  updateShape,
} from "../src/annotations/document.ts";
import { placePin } from "../src/annotations/pins.ts";
import {
  popoverEdge,
  popoverGap,
  popoverSpot,
  popoverWidth,
  threadMeasurement,
  threadMessages,
} from "../src/annotations/thread-popover.ts";

const lenka = { name: "Lenka Malá", initials: "LM", color: "#2563eb" };
const at = new Date("2026-11-05T12:00:00Z");

describe("messages in the popover", () => {
  const messages = [
    {
      id: "m1",
      author_id: "u1",
      body: "Does the boundary run past the fold?",
      mentions: [],
      created_at: "2026-11-05T11:35:00Z",
    },
    {
      id: "m2",
      author_id: "u2",
      body: "Checking",
      mentions: [],
      created_at: "2026-11-05T11:59:40Z",
    },
    {
      id: "m3",
      author_id: "ghost",
      body: "Old note",
      mentions: [],
      created_at: "2026-11-02T09:00:00Z",
    },
  ];
  const people = (id: string) => (id === "u1" ? lenka : undefined);
  const shown = threadMessages(messages, people, "u2", at);

  test("each message carries its author, text and relative time", () => {
    assert.equal(shown[0]?.author, lenka);
    assert.equal(shown[0]?.text, "Does the boundary run past the fold?");
    assert.equal(shown[0]?.at, "25 min ago");
    assert.equal(shown[1]?.at, "just now");
    assert.equal(shown[2]?.at, "2 Nov");
  });

  test("the reader's own messages are marked and unknown authors stay anonymous", () => {
    assert.equal(shown[0]?.you, false);
    assert.equal(shown[1]?.you, true);
    assert.equal(shown[2]?.author.name, "Someone");
  });

  test("messages keep the order the server gave", () => {
    assert.deepEqual(
      shown.map((message) => message.id),
      ["m1", "m2", "m3"],
    );
  });
});

describe("the measurement embed", () => {
  const square = new Float32Array([0, 0, 100, 0, 100, 100, 0, 100]);

  test("a pin on a closed shape embeds its area and perimeter", () => {
    const added = addShape(createDocument(), { kind: "polygon", points: square });
    const doc = placePin(added.document, "t1", { x: 50, y: 50 }, 2);
    const embed = threadMeasurement(doc, "t1", 0.5);
    assert.ok(embed);
    assert.match(embed.label, /^M1 · /);
    assert.deepEqual(
      embed.values.map((entry) => entry.name),
      ["Area", "Perimeter"],
    );
    assert.equal(embed.values[0]?.value, "2500 µm²");
    assert.equal(embed.values[1]?.value, "200 µm");
  });

  test("without a scale the embed reads in pixels", () => {
    const added = addShape(createDocument(), { kind: "polygon", points: square });
    const doc = placePin(added.document, "t1", { x: 50, y: 50 }, 2);
    assert.equal(threadMeasurement(doc, "t1", null)?.values[0]?.value, "10000 px²");
  });

  test("a pin on empty slide, an unknown thread or a hidden shape embeds nothing", () => {
    const added = addShape(createDocument(), { kind: "polygon", points: square });
    const empty = placePin(added.document, "t1", { x: 900, y: 900 }, 2);
    assert.equal(threadMeasurement(empty, "t1", 0.5), undefined);
    assert.equal(threadMeasurement(empty, "nobody", 0.5), undefined);
    const grouped = addGroup(added.document, "Tumor");
    const inGroup = updateShape(grouped.document, added.shape.id, {
      groupId: grouped.group.id,
    }).document;
    const pinned = placePin(inGroup, "t2", { x: 50, y: 50 }, 2);
    const hidden = updateGroup(pinned, grouped.group.id, { hidden: true }).document;
    assert.equal(threadMeasurement(hidden, "t2", 0.5), undefined);
  });

  test("linking a thread without a placement embeds nothing", () => {
    const added = addShape(createDocument(), { kind: "polygon", points: square });
    const linked = linkThread(added.document, added.shape.id, "t9").document;
    assert.equal(threadMeasurement(linked, "t9", 0.5), undefined);
  });
});

describe("where the popover opens", () => {
  const stage = { width: 1200, height: 800 };

  test("it opens to the right of the pin when there is room", () => {
    const spot = popoverSpot({ x: 300, y: 400 }, stage);
    assert.equal(spot.left, 300 + popoverGap);
  });

  test("it flips to the left near the right edge", () => {
    const spot = popoverSpot({ x: 1100, y: 400 }, stage);
    assert.equal(spot.left, 1100 - popoverGap - popoverWidth);
  });

  test("it stays inside the stage in every corner", () => {
    for (const pin of [
      { x: 0, y: 0 },
      { x: 1200, y: 0 },
      { x: 0, y: 800 },
      { x: 1200, y: 800 },
    ]) {
      const spot = popoverSpot(pin, stage, 300);
      assert.ok(spot.left >= popoverEdge);
      assert.ok(spot.left + popoverWidth <= stage.width - popoverEdge);
      assert.ok(spot.top >= popoverEdge);
      assert.ok(spot.top + 300 <= stage.height - popoverEdge);
    }
  });
});
