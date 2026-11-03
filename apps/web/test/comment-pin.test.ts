import assert from "node:assert/strict";
import { test } from "node:test";
import {
  escapeComment,
  isClick,
  pinForClick,
  pinOnScreen,
  pinThread,
  pinTitle,
  slidePoint,
} from "../src/screens/review/comment-pin.ts";

const camera = { x: 700, y: 900, scale: 0.5 };
const size = { width: 800, height: 600 };

test("a click in comment mode pins a point under the cursor", () => {
  const point = slidePoint(camera, size, { x: 500, y: 200 });
  assert.deepEqual(point, { x: 900, y: 700 });
  assert.deepEqual(pinForClick("comment", point), point);
});

test("the pin draws back at the clicked screen point", () => {
  const point = slidePoint(camera, size, { x: 123, y: 456 });
  const back = pinOnScreen(camera, size, point);
  assert.ok(Math.abs(back.x - 123) < 0.1);
  assert.ok(Math.abs(back.y - 456) < 0.1);
});

test("a click outside comment mode pins nothing", () => {
  const point = { x: 1, y: 2 };
  assert.equal(pinForClick(undefined, point), null);
  assert.equal(pinForClick("hand", point), null);
  assert.equal(pinForClick("ruler", point), null);
});

test("a drag past the slop is a pan, not a click", () => {
  assert.equal(isClick({ x: 10, y: 10 }, { x: 12, y: 12 }), true);
  assert.equal(isClick({ x: 10, y: 10 }, { x: 20, y: 10 }), false);
});

test("the new thread is anchored at the pinned point", () => {
  assert.deepEqual(pinThread({ x: 900, y: 700 }, "  Look here\nsecond line "), {
    title: "Look here",
    body: "Look here\nsecond line",
    anchor: {
      kind: "point",
      object_id: null,
      geometry: { type: "Point", coordinates: [900, 700] },
      offset: null,
    },
  });
});

test("an empty comment makes no thread", () => {
  assert.equal(pinThread({ x: 1, y: 1 }, "   "), null);
});

test("a long first line is cut to the 120 character title limit", () => {
  const title = pinTitle("a".repeat(200));
  assert.equal(title.length, 120);
  assert.ok(title.endsWith("…"));
});

test("Esc leaves comment mode and drops the pin without a thread", () => {
  assert.deepEqual(escapeComment({ tool: "comment", pin: { x: 3, y: 4 } }), {
    tool: undefined,
    pin: null,
  });
  assert.deepEqual(escapeComment({ tool: "comment", pin: null }), { tool: undefined, pin: null });
});

test("Esc outside comment mode is left to the other handlers", () => {
  assert.equal(escapeComment({ tool: undefined, pin: null }), null);
  assert.equal(escapeComment({ tool: "ruler", pin: null }), null);
});
