import assert from "node:assert/strict";
import { mock, test } from "node:test";
import type { RoomSignal } from "@parfocal/edge/room-client";
import { onPointer, reportPointer } from "../src/presence/cursor-bridge.ts";
import {
  cursorFrame,
  cursorSender,
  goneFrame,
  heardCursorOf,
  pointOfShare,
  shareOfPoint,
  withCursor,
} from "../src/presence/shared-cursor.ts";
import { pointOnPane, screenOfPoint } from "../src/screens/viewer-tools/cursor-map.ts";

const slide = { width: 80_000, height: 40_000 };
const at = { x: 0.25, y: 0.75 };

test("a cursor frame from a colleague is heard as a share of the slide", () => {
  assert.deepEqual(heardCursorOf({ ...cursorFrame(at), user: "ben" }, "anna"), {
    user: "ben",
    gone: false,
    at,
  });
  assert.deepEqual(heardCursorOf({ ...goneFrame, user: "ben" }, "anna"), {
    user: "ben",
    gone: true,
  });
});

test("my own frames, unsigned frames, other types and broken numbers are ignored", () => {
  assert.equal(heardCursorOf({ ...cursorFrame(at), user: "anna" }, "anna"), null);
  assert.equal(heardCursorOf(cursorFrame(at), "anna"), null);
  assert.equal(heardCursorOf({ type: "view", user: "ben", x: 1, y: 2, zoom: 3 }, "anna"), null);
  assert.equal(heardCursorOf({ type: "cursor", user: "ben", x: 1, y: "2" }, "anna"), null);
  assert.equal(heardCursorOf({ type: "cursor", user: "ben", x: null, y: 2 }, "anna"), null);
});

test("a slide point travels as a share that fits the frame cap and lands on the same point", () => {
  const share = shareOfPoint({ x: 20_000.4, y: 30_000 }, slide);
  assert.deepEqual(share, { x: 0.25001, y: 0.75 });
  assert.ok(JSON.stringify({ ...cursorFrame(share), n: 1 }).length <= 96);
  const back = pointOfShare(share, slide);
  assert.ok(Math.abs(back.x - 20_000.4) < 1);
  assert.equal(back.y, 30_000);
  assert.deepEqual(pointOfShare(share, { width: 1600, height: 1000 }), { x: 400.016, y: 750 });
});

function paced() {
  mock.timers.enable({ apis: ["setTimeout"] });
  const clock = { time: 1000 };
  const sent: RoomSignal[] = [];
  const sender = cursorSender(
    (signal) => sent.push(signal),
    50,
    () => clock.time,
  );
  const pass = (ms: number) => {
    clock.time += ms;
    mock.timers.tick(ms);
  };
  return { sent, sender, pass };
}

test("many moves inside one window send two frames and the second carries the last point", () => {
  const { sent, sender, pass } = paced();
  for (let step = 0; step < 20; step += 1) {
    sender.move({ x: step / 100, y: 0.5 });
    pass(2);
  }
  assert.deepEqual(sent, [cursorFrame({ x: 0, y: 0.5 })]);
  pass(10);
  assert.deepEqual(sent, [cursorFrame({ x: 0, y: 0.5 }), cursorFrame({ x: 0.19, y: 0.5 })]);
  mock.timers.reset();
});

test("a second of steady movement sends at most twenty one frames", () => {
  const { sent, sender, pass } = paced();
  for (let step = 0; step < 1000; step += 1) {
    sender.move({ x: step / 1000, y: 0.5 });
    pass(1);
  }
  assert.ok(sent.length >= 19 && sent.length <= 21, `${sent.length} frames`);
  mock.timers.reset();
});

test("a pointer that rests sends nothing more and leaving sends one gone frame", () => {
  const { sent, sender, pass } = paced();
  sender.move(at);
  pass(60);
  sender.move(at);
  pass(60);
  assert.deepEqual(sent, [cursorFrame(at)]);
  sender.move({ x: 0.3, y: 0.3 });
  pass(10);
  sender.move({ x: 0.4, y: 0.4 });
  sender.leave();
  pass(100);
  assert.deepEqual(sent.slice(1), [cursorFrame({ x: 0.3, y: 0.3 }), goneFrame]);
  sender.leave();
  assert.equal(sent.length, 3);
  mock.timers.reset();
});

test("a cancelled sender drops the frame that was waiting", () => {
  const { sent, sender, pass } = paced();
  sender.move(at);
  pass(10);
  sender.move({ x: 0.9, y: 0.9 });
  sender.cancel();
  pass(100);
  assert.deepEqual(sent, [cursorFrame(at)]);
  mock.timers.reset();
});

test("the stage pointer reaches only the listeners of its own slide until they leave", () => {
  const heard: unknown[] = [];
  const stop = onPointer("slide-a", (point) => heard.push(point));
  reportPointer("slide-a", at);
  reportPointer("slide-b", { x: 0, y: 0 });
  reportPointer("slide-a", null);
  stop();
  reportPointer("slide-a", at);
  assert.deepEqual(heard, [at, null]);
});

test("the shown cursors keep one entry per person and drop a person who is gone", () => {
  const one = withCursor([], { user: "ben", gone: false, at });
  const moved = withCursor(one, { user: "ben", gone: false, at: { x: 0.5, y: 0.5 } });
  assert.deepEqual(moved, [{ user: "ben", at: { x: 0.5, y: 0.5 } }]);
  const two = withCursor(moved, { user: "cara", gone: false, at });
  assert.equal(two.length, 2);
  assert.deepEqual(withCursor(two, { user: "ben", gone: true }), [{ user: "cara", at }]);
});

test("in compare the cursor is drawn on the room's slide and carried by the pane offset", () => {
  const offsets = {
    left: { x: 0, y: 0, zoom: 0, rotation: 0 },
    right: { x: 40, y: -10, zoom: 0, rotation: 0 },
  };
  const point = pointOfShare(at, { width: 1600, height: 1000 });
  assert.deepEqual(pointOnPane(point, "left", "left", offsets), { x: 400, y: 750 });
  assert.deepEqual(pointOnPane(point, "left", "right", offsets), { x: 440, y: 740 });
  assert.equal(pointOnPane(point, undefined, "right", offsets), null);
  const view = { x: 800, y: 500, zoom: -1, rotation: 0 };
  const box = { width: 800, height: 500 };
  assert.deepEqual(screenOfPoint(view, box, { x: 400, y: 750 }), { x: 200, y: 375 });
});
