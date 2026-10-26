import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGestureInterpreter,
  createTapRecognizer,
  type InputAction,
  type PointerInput,
  touchTuning,
} from "../../src/index.ts";

const noModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };

function touch(
  kind: PointerInput["kind"],
  id: number,
  x: number,
  y: number,
  timeMs: number,
): PointerInput {
  return {
    kind,
    pointerId: id,
    pointerType: "touch",
    button: kind === "move" ? -1 : 0,
    buttons: kind === "up" || kind === "cancel" ? 0 : 1,
    clientX: x,
    clientY: y,
    timeMs,
    ...noModifiers,
  };
}

function kinds(actions: readonly InputAction[]): string[] {
  return actions.map((action) => action.kind);
}

function tap(
  input: ReturnType<typeof createGestureInterpreter>,
  at: { x: number; y: number },
  downMs: number,
  holdMs = 60,
): readonly InputAction[] {
  input.handle(touch("down", 1, at.x, at.y, downMs));
  return input.handle(touch("up", 1, at.x, at.y, downMs + holdMs));
}

function twoFingerTap(
  input: ReturnType<typeof createGestureInterpreter>,
  downMs: number,
  holdMs = 60,
): readonly InputAction[] {
  input.handle(touch("down", 1, 300, 300, downMs));
  input.handle(touch("down", 2, 400, 300, downMs + 5));
  input.handle(touch("up", 1, 300, 300, downMs + holdMs));
  return input.handle(touch("up", 2, 400, 300, downMs + holdMs + 5));
}

test("the tap values live in one place with the 40x target", () => {
  assert.deepEqual(touchTuning, {
    tapSlopPx: 10,
    tapMaxMs: 300,
    doubleTapWindowMs: 350,
    doubleTapSlopPx: 40,
    doubleTapMagnification: 40,
    syntheticDoubleClickGuardMs: 500,
  });
});

test("one finger pans through the drag actions and ends the drag on lift", () => {
  const input = createGestureInterpreter();
  assert.deepEqual(kinds(input.handle(touch("down", 1, 100, 100, 0))), [
    "startDrag",
    "capture",
    "cursor",
  ]);
  assert.deepEqual(kinds(input.handle(touch("move", 1, 140, 100, 16))), ["dragTo"]);
  assert.deepEqual(kinds(input.handle(touch("up", 1, 140, 100, 32))), [
    "endDrag",
    "release",
    "cursor",
  ]);
});

test("a single tap zooms nothing and a second tap nearby zooms to 40x about the tap", () => {
  const input = createGestureInterpreter();
  assert.equal(kinds(tap(input, { x: 200, y: 150 }, 0)).includes("magnify"), false);
  const second = tap(input, { x: 210, y: 155 }, 200);
  assert.deepEqual(second.at(-1), {
    kind: "magnify",
    magnification: 40,
    at: { clientX: 210, clientY: 155 },
  });
});

test("a third tap starts a new pair instead of repeating the zoom", () => {
  const input = createGestureInterpreter();
  tap(input, { x: 200, y: 150 }, 0);
  tap(input, { x: 200, y: 150 }, 200);
  assert.equal(kinds(tap(input, { x: 200, y: 150 }, 400)).includes("magnify"), false);
  assert.equal(kinds(tap(input, { x: 200, y: 150 }, 600)).includes("magnify"), true);
});

test("taps too far apart in time or space do not pair", () => {
  const late = createGestureInterpreter();
  tap(late, { x: 200, y: 150 }, 0);
  assert.equal(
    kinds(tap(late, { x: 200, y: 150 }, 60 + touchTuning.doubleTapWindowMs + 1)).includes(
      "magnify",
    ),
    false,
  );
  const far = createGestureInterpreter();
  tap(far, { x: 200, y: 150 }, 0);
  assert.equal(
    kinds(tap(far, { x: 200 + touchTuning.doubleTapSlopPx + 1, y: 150 }, 200)).includes("magnify"),
    false,
  );
});

test("a press that is held or dragged is not a tap", () => {
  const held = createGestureInterpreter();
  tap(held, { x: 200, y: 150 }, 0, touchTuning.tapMaxMs + 1);
  assert.equal(kinds(tap(held, { x: 200, y: 150 }, 500)).includes("magnify"), false);

  const dragged = createGestureInterpreter();
  tap(dragged, { x: 200, y: 150 }, 0);
  dragged.handle(touch("down", 1, 200, 150, 200));
  dragged.handle(touch("move", 1, 200 + touchTuning.tapSlopPx + 1, 150, 216));
  const lift = dragged.handle(touch("up", 1, 220, 150, 260));
  assert.equal(kinds(lift).includes("magnify"), false);
});

test("a finger that wobbles inside the slop still taps", () => {
  const input = createGestureInterpreter();
  tap(input, { x: 200, y: 150 }, 0);
  input.handle(touch("down", 1, 200, 150, 200));
  input.handle(touch("move", 1, 200 + touchTuning.tapSlopPx - 1, 150, 216));
  const lift = input.handle(touch("up", 1, 205, 150, 260));
  assert.equal(kinds(lift).includes("magnify"), true);
});

test("a two-finger double tap fits the whole slide and a one-finger tap pair does not", () => {
  const input = createGestureInterpreter();
  assert.equal(kinds(twoFingerTap(input, 0)).includes("fitSlide"), false);
  const second = twoFingerTap(input, 250);
  assert.deepEqual(second.at(-1), { kind: "fitSlide" });
  assert.equal(kinds(second).includes("magnify"), false);
});

test("a one-finger tap followed by a two-finger tap does not pair", () => {
  const input = createGestureInterpreter();
  tap(input, { x: 350, y: 300 }, 0);
  const actions = twoFingerTap(input, 200);
  assert.equal(kinds(actions).includes("fitSlide"), false);
  assert.equal(kinds(actions).includes("magnify"), false);
});

test("two fingers that pinch are not a tap", () => {
  const input = createGestureInterpreter();
  twoFingerTap(input, 0);
  input.handle(touch("down", 1, 300, 300, 250));
  input.handle(touch("down", 2, 400, 300, 255));
  input.handle(touch("move", 2, 460, 300, 271));
  input.handle(touch("up", 1, 300, 300, 300));
  assert.equal(kinds(input.handle(touch("up", 2, 460, 300, 305))).includes("fitSlide"), false);
});

test("a third finger spoils a two-finger tap", () => {
  const input = createGestureInterpreter();
  twoFingerTap(input, 0);
  input.handle(touch("down", 1, 300, 300, 250));
  input.handle(touch("down", 2, 400, 300, 255));
  input.handle(touch("down", 3, 350, 400, 258));
  input.handle(touch("up", 3, 350, 400, 290));
  input.handle(touch("up", 1, 300, 300, 300));
  assert.equal(kinds(input.handle(touch("up", 2, 400, 300, 305))).includes("fitSlide"), false);
});

test("a cancelled touch forgets the taps before it", () => {
  const input = createGestureInterpreter();
  tap(input, { x: 200, y: 150 }, 0);
  input.handle(touch("down", 1, 200, 150, 150));
  const cancelled = input.handle(touch("cancel", 1, 200, 150, 170));
  assert.deepEqual(kinds(cancelled), ["abandonDrag", "release", "cursor"]);
  assert.equal(kinds(tap(input, { x: 200, y: 150 }, 250)).includes("magnify"), false);
});

test("lifting one pinch finger hands over to a drag from the remaining finger without a pan or zoom", () => {
  const input = createGestureInterpreter();
  input.handle(touch("down", 1, 300, 300, 0));
  input.handle(touch("down", 2, 400, 300, 5));
  input.handle(touch("move", 2, 500, 300, 100));
  const lift = input.handle(touch("up", 2, 500, 300, 200));
  assert.deepEqual(kinds(lift), ["release", "startDrag"]);
  assert.deepEqual(lift[1], { kind: "startDrag", at: { clientX: 300, clientY: 300 } });
});

test("mouse input and touch input without timestamps never make taps", () => {
  const input = createGestureInterpreter();
  const bare = (kind: "down" | "up"): PointerInput => {
    const { timeMs: _timeMs, ...rest } = touch(kind, 1, 100, 100, 0);
    return rest;
  };
  for (let round = 0; round < 3; round++) {
    input.handle(bare("down"));
    assert.equal(kinds(input.handle(bare("up"))).includes("magnify"), false);
  }
  const mouse = (kind: "down" | "up"): PointerInput => ({
    ...touch(kind, 1, 100, 100, 0),
    pointerType: "mouse",
  });
  for (let round = 0; round < 3; round++) {
    input.handle(mouse("down"));
    assert.equal(kinds(input.handle(mouse("up"))).includes("magnify"), false);
  }
});

test("the recognizer pairs taps by finger count and resets on demand", () => {
  const recognizer = createTapRecognizer();
  const at = { clientX: 10, clientY: 10 };
  recognizer.down(1, at, 0);
  assert.equal(recognizer.up(50, 0), null);
  recognizer.reset();
  recognizer.down(1, at, 100);
  assert.equal(recognizer.up(150, 0), null);
  recognizer.down(1, at, 200);
  assert.deepEqual(recognizer.up(250, 0), { kind: "magnify", at });
});
