import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyWheel,
  createGestureInterpreter,
  defaultCameraProfile,
  freshWheelClassifier,
  type GestureHooks,
  type InputAction,
  isPinchWheel,
  macMouseWheelStep,
  type PointerInput,
  type WheelClassifier,
  type WheelDelta,
  type WheelInput,
  wheelEventOctaves,
} from "../../src/index.ts";
import { createReplayRig } from "./replay.ts";

const noModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const viewport = { left: 0, top: 0, width: 800, height: 600 };

function delta(deltaY: number, rest: Partial<WheelDelta> = {}): WheelDelta {
  return { deltaX: 0, deltaY, deltaMode: 0, ctrlKey: false, metaKey: false, ...rest };
}

function wheel(deltaY: number, rest: Partial<WheelInput> = {}): WheelInput {
  return {
    kind: "wheel",
    clientX: 400,
    clientY: 300,
    deltaX: 0,
    deltaY,
    deltaMode: 0,
    ...noModifiers,
    ...rest,
  };
}

function pointer(
  kind: PointerInput["kind"],
  clientX: number,
  clientY: number,
  rest: Partial<PointerInput> = {},
): PointerInput {
  const pressed = kind === "down" || kind === "move";
  return {
    kind,
    clientX,
    clientY,
    pointerId: 1,
    pointerType: "mouse",
    button: kind === "move" ? -1 : 0,
    buttons: pressed ? 1 : 0,
    ...noModifiers,
    ...rest,
  };
}

function kinds(actions: readonly InputAction[]): string[] {
  return actions.map((action) => action.kind);
}

function classify(...deltas: WheelDelta[]): WheelClassifier {
  return deltas.reduce(classifyWheel, freshWheelClassifier);
}

test("a mouse notch needs two whole single-axis steps to win back from a trackpad", () => {
  const trackpad = classify(delta(2.5));
  assert.equal(trackpad.device, "trackpad");
  assert.equal(classifyWheel(trackpad, delta(100)).device, "trackpad");
  assert.equal(classify(delta(2.5), delta(100), delta(100)).device, "mouse");
});

test("line mode and the Mac mouse step are mouse wheels at once", () => {
  assert.equal(classify(delta(2.5), delta(3, { deltaMode: 1 })).device, "mouse");
  assert.equal(classify(delta(2.5), delta(macMouseWheelStep * 3)).device, "mouse");
});

test("fractional, tiny or two-axis deltas are a trackpad", () => {
  assert.equal(classify(delta(7.25)).device, "trackpad");
  assert.equal(classify(delta(2)).device, "trackpad");
  assert.equal(classify(delta(12, { deltaX: 3 })).device, "trackpad");
  assert.equal(classify(delta(12)).device, "mouse");
});

test("a modifier wheel event leaves the device guess alone", () => {
  const trackpad = classify(delta(2.5));
  assert.equal(classifyWheel(trackpad, delta(-100, { ctrlKey: true })), trackpad);
});

test("pinch is told apart from Ctrl+wheel by the shape of the delta", () => {
  assert.equal(isPinchWheel(delta(1.37, { ctrlKey: true })), true);
  assert.equal(isPinchWheel(delta(6, { ctrlKey: true })), true);
  assert.equal(isPinchWheel(delta(100, { ctrlKey: true })), false);
  assert.equal(isPinchWheel(delta(3, { ctrlKey: true, deltaMode: 1 })), false);
  assert.equal(isPinchWheel(delta(macMouseWheelStep, { ctrlKey: true })), false);
  assert.equal(isPinchWheel(delta(1.37)), false);
});

test("each wheel event is capped at half an octave", () => {
  assert.equal(wheelEventOctaves(delta(4000)).octaves, -defaultCameraProfile.maxOctavesPerEvent);
  assert.equal(wheelEventOctaves(delta(-4000)).octaves, defaultCameraProfile.maxOctavesPerEvent);
  assert.equal(
    wheelEventOctaves(delta(-200.5, { ctrlKey: true })).octaves,
    defaultCameraProfile.maxOctavesPerEvent,
  );
  assert.equal(
    wheelEventOctaves(delta(-30, { deltaMode: 2 })).octaves,
    defaultCameraProfile.maxOctavesPerEvent,
  );
});

test("a notch out undoes a notch in, so repeated zooming never drifts", () => {
  const notchIn = wheelEventOctaves(delta(-100));
  const notchOut = wheelEventOctaves(delta(100));
  assert.equal(notchIn.octaves + notchOut.octaves, 0);
  assert.equal(notchIn.animate, true);
  assert.equal(wheelEventOctaves(delta(-2, { ctrlKey: true })).animate, false);
});

test("a drag starts, follows and ends with capture and cursor changes", () => {
  const input = createGestureInterpreter();
  assert.deepEqual(kinds(input.handle(pointer("down", 10, 10))), [
    "startDrag",
    "capture",
    "cursor",
  ]);
  assert.deepEqual(kinds(input.handle(pointer("move", 20, 15))), ["dragTo"]);
  assert.deepEqual(kinds(input.handle(pointer("up", 20, 15))), ["endDrag", "release", "cursor"]);
  assert.equal(input.activePointers(), 0);
  assert.deepEqual(input.handle(pointer("move", 40, 40)), []);
});

for (const end of ["cancel", "lostcapture", "blur", "buttons released"] as const) {
  test(`${end} ends the drag without a throw and the next move does not pan`, () => {
    const input = createGestureInterpreter();
    input.handle(pointer("down", 10, 10));
    input.handle(pointer("move", 50, 10));
    const actions =
      end === "blur"
        ? input.handle({ kind: "blur" })
        : end === "buttons released"
          ? input.handle(pointer("move", 60, 10, { buttons: 0 }))
          : input.handle(pointer(end, 50, 10));
    assert.deepEqual(kinds(actions), ["abandonDrag", "release", "cursor"]);
    assert.equal(input.gesture(), "none");
    assert.equal(input.activePointers(), 0);
    assert.deepEqual(input.handle(pointer("move", 90, 10)), []);
    assert.deepEqual(input.handle(pointer("up", 90, 10)), []);
  });
}

test("a lost capture after the release does nothing", () => {
  const input = createGestureInterpreter();
  input.handle(pointer("down", 10, 10));
  input.handle(pointer("up", 10, 10));
  assert.deepEqual(input.handle(pointer("lostcapture", 10, 10)), []);
});

test("middle-drag pans in any tool and Space+drag pans through the hook", () => {
  let spaceHeld = false;
  const hooks: GestureHooks = { primaryDragPans: () => false, panModifierHeld: () => spaceHeld };
  const input = createGestureInterpreter(hooks);
  assert.deepEqual(input.handle(pointer("down", 10, 10)), []);
  input.handle(pointer("up", 10, 10));
  assert.deepEqual(kinds(input.handle(pointer("down", 10, 10, { button: 1, buttons: 4 }))), [
    "preventDefault",
    "startDrag",
    "capture",
    "cursor",
  ]);
  assert.deepEqual(kinds(input.handle(pointer("move", 30, 10, { buttons: 4 }))), ["dragTo"]);
  input.handle(pointer("up", 30, 10, { button: 1 }));
  spaceHeld = true;
  assert.deepEqual(kinds(input.handle(pointer("down", 10, 10))), [
    "startDrag",
    "capture",
    "cursor",
  ]);
});

test("the right button never pans", () => {
  const input = createGestureInterpreter();
  assert.deepEqual(input.handle(pointer("down", 10, 10, { button: 2, buttons: 2 })), []);
});

test("double-click zooms in an octave about the cursor and Alt+double-click zooms out", () => {
  const input = createGestureInterpreter();
  const at = { clientX: 120, clientY: 80 };
  const zoomIn = input.handle({ kind: "dblclick", ...at, button: 0, ...noModifiers });
  assert.deepEqual(zoomIn.at(-1), { kind: "zoom", octaves: 1, at, animate: true });
  const zoomOut = input.handle({
    kind: "dblclick",
    ...at,
    button: 0,
    ...noModifiers,
    altKey: true,
  });
  assert.deepEqual(zoomOut.at(-1), { kind: "zoom", octaves: -1, at, animate: true });
});

test("double-click on a shape the active tool edits is left to the tool", () => {
  const input = createGestureInterpreter({ hitsEditableShape: (at) => at.clientX < 100 });
  assert.deepEqual(
    input.handle({ kind: "dblclick", clientX: 50, clientY: 50, button: 0, ...noModifiers }),
    [],
  );
  assert.equal(
    input.handle({ kind: "dblclick", clientX: 150, clientY: 50, button: 0, ...noModifiers }).length,
    2,
  );
});

test("two touch pointers pinch about their midpoint and hand back to a drag", () => {
  const input = createGestureInterpreter();
  const touch = (kind: PointerInput["kind"], id: number, x: number, y: number) =>
    pointer(kind, x, y, {
      pointerId: id,
      pointerType: "touch",
      button: 0,
      buttons: kind === "up" ? 0 : 1,
    });
  input.handle(touch("down", 1, 100, 100));
  assert.deepEqual(kinds(input.handle(touch("down", 2, 200, 100))), ["abandonDrag", "capture"]);
  assert.equal(input.gesture(), "pinch");
  const spread = input.handle(touch("move", 2, 300, 100));
  assert.deepEqual(spread[0], { kind: "pan", dx: 50, dy: 0 });
  assert.deepEqual(spread[1], {
    kind: "zoom",
    octaves: 1,
    at: { clientX: 200, clientY: 100 },
    animate: false,
  });
  assert.deepEqual(input.handle(touch("up", 2, 300, 100)), [
    { kind: "release", pointerId: 2 },
    { kind: "startDrag", at: { clientX: 100, clientY: 100 } },
  ]);
  assert.equal(input.gesture(), "drag");
  assert.deepEqual(kinds(input.handle(touch("up", 1, 100, 100))), ["endDrag", "release", "cursor"]);
});

test("coalesced samples each reach the drag with their age", () => {
  const input = createGestureInterpreter();
  input.handle(pointer("down", 0, 0));
  const actions = input.handle(
    pointer("move", 30, 0, {
      samples: [
        { clientX: 10, clientY: 0, ageMs: 8 },
        { clientX: 20, clientY: 0, ageMs: 4 },
        { clientX: 30, clientY: 0, ageMs: 0 },
      ],
    }),
  );
  assert.deepEqual(
    actions.map((action) => (action.kind === "dragTo" ? [action.at.clientX, action.ageMs] : null)),
    [
      [10, 8],
      [20, 4],
      [30, 0],
    ],
  );
});

test("coalesced samples give a fast stroke its real release speed", () => {
  const throwWith = (coalesced: boolean) => {
    const rig = createReplayRig(viewport);
    const start = rig.camera();
    rig.feed(pointer("down", 0, 0), 0);
    const samples = [15, 30, 45, 60].map((clientX, index) => ({
      clientX,
      clientY: 0,
      ageMs: 30 - index * 10,
    }));
    rig.feed(pointer("move", 60, 0, coalesced ? { samples } : {}), 200);
    rig.feed(pointer("up", 60, 0), 200);
    rig.settle();
    return (start.x - rig.camera().x) * 2 ** start.zoom;
  };
  const withSamples = throwWith(true);
  const without = throwWith(false);
  assert.ok(withSamples > without + 50, `${withSamples} px against ${without} px`);
});

test("a wheel zoom during a drag is not eased and the drag carries on", () => {
  const input = createGestureInterpreter();
  input.handle(pointer("down", 10, 10));
  input.handle(pointer("move", 20, 10));
  const actions = input.handle(wheel(-100));
  assert.deepEqual(kinds(actions), ["preventDefault", "zoom", "startDrag"]);
  const zoom = actions[1];
  assert.ok(zoom?.kind === "zoom" && !zoom.animate);
  assert.equal(input.gesture(), "drag");
});

test("Ctrl or Cmd+wheel zooms whatever the wheel mode", () => {
  const input = createGestureInterpreter({}, "pan");
  assert.equal(input.handle(wheel(-100, { ctrlKey: true }))[1]?.kind, "zoom");
  assert.equal(input.handle(wheel(-100, { metaKey: true }))[1]?.kind, "zoom");
  assert.equal(input.handle(wheel(-100))[1]?.kind, "pan");
});

test("auto mode zooms with a mouse wheel and pans with a trackpad scroll", () => {
  const input = createGestureInterpreter();
  assert.equal(input.handle(wheel(100))[1]?.kind, "zoom");
  assert.equal(input.handle(wheel(3.5))[1]?.kind, "pan");
  assert.equal(input.wheelDevice(), "trackpad");
  input.setWheelMode("auto");
  assert.equal(input.wheelDevice(), "mouse");
});

test("every wheel event is consumed so the page never scrolls or zooms", () => {
  const input = createGestureInterpreter();
  for (const event of [wheel(100), wheel(2.5), wheel(-1.2, { ctrlKey: true }), wheel(0)]) {
    assert.equal(input.handle(event)[0]?.kind, "preventDefault");
  }
});
