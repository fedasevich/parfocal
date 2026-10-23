import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  type Camera,
  defaultCameraProfile,
  type InputAction,
  type InputPoint,
  isPinchWheel,
  type WheelInput,
  type WheelMode,
} from "../../src/index.ts";
import { createReplayRig, loadTraces, type ReplayStep, traceInput } from "./replay.ts";
import type { InputTrace, TraceGesture } from "./trace-format.ts";

const traces = loadTraces();
const anchorTolerancePx = 0.5;
const trackpadPanShare = 0.8;

type Replay = ReturnType<typeof replayGesture>;

function replayGesture(
  trace: InputTrace,
  gesture: TraceGesture,
  mode: WheelMode = "auto",
  primaryDragPans = true,
) {
  const rig = createReplayRig(trace.viewport, mode, { primaryDragPans: () => primaryDragPans });
  const start = rig.camera();
  const steps: ReplayStep[] = gesture.events.map((event) => rig.feed(traceInput(event), event.t));
  const released = rig.camera();
  rig.settle();
  return { rig, start, steps, released, end: rig.camera() };
}

function actionsOf(steps: readonly ReplayStep[], kind: InputAction["kind"]): InputAction[] {
  return steps.flatMap((step) => step.actions.filter((action) => action.kind === kind));
}

function wheelSteps(steps: readonly ReplayStep[]): ReplayStep[] {
  return steps.filter((step) => step.input.kind === "wheel");
}

function zoomOf(step: ReplayStep) {
  return step.actions.find((action) => action.kind === "zoom");
}

function panOf(step: ReplayStep) {
  return step.actions.find((action) => action.kind === "pan");
}

function assertFinite(camera: Camera) {
  assert.ok(
    Number.isFinite(camera.x) && Number.isFinite(camera.y) && Number.isFinite(camera.zoom),
    `the camera is not finite: ${JSON.stringify(camera)}`,
  );
}

function assertAnchored(replay: Replay, at: InputPoint) {
  const point = replay.rig.slideAt(replay.start, at);
  for (const camera of [...replay.rig.frames(), replay.end]) {
    const screen = replay.rig.screenOf(camera, point);
    const drift = Math.hypot(screen.clientX - at.clientX, screen.clientY - at.clientY);
    assert.ok(drift < anchorTolerancePx, `the point under the cursor drifted ${drift} px`);
  }
}

function wheelPoint(gesture: TraceGesture): InputPoint {
  const first = gesture.events[0];
  if (!first) throw new Error(`The ${gesture.gesture} gesture has no events`);
  return { clientX: first.clientX, clientY: first.clientY };
}

function expectScroll(trace: InputTrace, gesture: TraceGesture, sign: 1 | -1) {
  const replay = replayGesture(trace, gesture);
  const wheels = wheelSteps(replay.steps);
  if (trace.device === "mouse") {
    for (const step of wheels) {
      const zoom = zoomOf(step);
      assert.ok(zoom && zoom.kind === "zoom", "a mouse wheel notch zooms in auto mode");
      assert.equal(zoom.animate, true, "a wheel notch zoom is eased");
      assert.equal(Math.sign(zoom.octaves), -sign);
    }
    assert.equal(Math.sign(replay.end.zoom - replay.start.zoom), -sign);
    assertAnchored(replay, wheelPoint(gesture));
    assert.equal(replay.rig.interpreter.wheelDevice(), "mouse");
    return;
  }
  const panned = wheels.filter((step) => panOf(step) !== undefined).length;
  assert.ok(
    panned >= wheels.length * trackpadPanShare,
    `only ${panned} of ${wheels.length} trackpad scroll events panned`,
  );
  assert.equal(replay.rig.interpreter.wheelDevice(), "trackpad");
  assert.equal(Math.sign(replay.end.y - replay.start.y), sign);
}

function expectPinch(trace: InputTrace, gesture: TraceGesture, sign: 1 | -1) {
  const replay = replayGesture(trace, gesture);
  for (const step of wheelSteps(replay.steps)) {
    assert.ok(isPinchWheel(step.input as WheelInput), "every pinch event reads as a pinch");
    const zoom = zoomOf(step);
    assert.ok(zoom && zoom.kind === "zoom");
    assert.equal(zoom.animate, false, "a pinch follows the fingers without easing");
  }
  assert.equal(Math.sign(replay.end.zoom - replay.start.zoom), sign);
  assertAnchored(replay, wheelPoint(gesture));
}

function expectDrag(trace: InputTrace, gesture: TraceGesture, primaryDragPans: boolean) {
  const replay = replayGesture(trace, gesture, "auto", primaryDragPans);
  const first = gesture.events[0];
  const last = gesture.events.at(-1);
  if (!first || !last) throw new Error("The drag has no events");
  const scale = 2 ** replay.start.zoom;
  assert.ok(
    Math.abs((replay.start.x - replay.released.x) * scale - (last.clientX - first.clientX)) < 1e-6,
  );
  assert.ok(
    Math.abs((replay.start.y - replay.released.y) * scale - (last.clientY - first.clientY)) < 1e-6,
  );
  assert.equal(replay.rig.interpreter.gesture(), "none");
  assert.equal(replay.rig.interpreter.activePointers(), 0);
}

function expectGesture(trace: InputTrace, gesture: TraceGesture) {
  switch (gesture.gesture) {
    case "scroll-down":
      return expectScroll(trace, gesture, 1);
    case "scroll-up":
      return expectScroll(trace, gesture, -1);
    case "scroll-sideways": {
      const replay = replayGesture(trace, gesture);
      const travel = gesture.events.reduce(
        (sum, event) => sum + (event.type === "wheel" ? event.deltaX : 0),
        0,
      );
      if (trace.device === "trackpad") {
        assert.equal(Math.sign(replay.end.x - replay.start.x), Math.sign(travel));
        assert.equal(replay.end.zoom, replay.start.zoom);
      }
      return;
    }
    case "pinch-out":
      return expectPinch(trace, gesture, 1);
    case "pinch-in":
      return expectPinch(trace, gesture, -1);
    case "ctrl-wheel": {
      const replay = replayGesture(trace, gesture);
      for (const step of wheelSteps(replay.steps)) {
        const zoom = zoomOf(step);
        assert.ok(zoom && zoom.kind === "zoom", "Ctrl+wheel always zooms");
        if (trace.device === "mouse") {
          assert.equal(isPinchWheel(step.input as WheelInput), false, "Ctrl+wheel is not a pinch");
          assert.equal(zoom.animate, true);
        }
      }
      assertAnchored(replay, wheelPoint(gesture));
      return;
    }
    case "shift-wheel": {
      const replay = replayGesture(trace, gesture, "pan");
      for (const step of wheelSteps(replay.steps)) {
        const pan = panOf(step);
        assert.ok(pan && pan.kind === "pan", "Shift+wheel pans in pan mode");
        assert.equal(pan.dy, 0, "Shift+wheel pans sideways only");
        assert.notEqual(pan.dx, 0);
      }
      return;
    }
    case "drag":
      return expectDrag(trace, gesture, true);
    case "middle-drag":
      return expectDrag(trace, gesture, false);
    case "double-click":
    case "alt-double-click": {
      const replay = replayGesture(trace, gesture);
      const expected = gesture.gesture === "double-click" ? 1 : -1;
      assert.ok(Math.abs(replay.end.zoom - replay.start.zoom - expected) < 1e-9);
      assertAnchored(replay, wheelPoint(gesture));
      return;
    }
  }
}

test("there is at least one trace for a mouse and one for a trackpad", () => {
  const devices = new Set(traces.map(({ trace }) => trace.device));
  assert.ok(devices.has("mouse"));
  assert.ok(devices.has("trackpad"));
});

test("trace files say whether they are synthetic or recorded in their name and body", () => {
  for (const { file, trace } of traces) {
    assert.equal(file.includes(".synthetic."), trace.origin === "synthetic", file);
    if (trace.origin === "synthetic") assert.match(trace.todo ?? "", /^TODO/, file);
  }
});

for (const { file, trace } of traces) {
  describe(`${file} (${trace.origin}, ${trace.label})`, () => {
    for (const gesture of trace.gestures) {
      test(`${gesture.gesture} behaves as expected`, () => expectGesture(trace, gesture));
    }

    test("no wheel event moves the zoom by more than half an octave", () => {
      for (const gesture of trace.gestures) {
        for (const mode of ["auto", "zoom", "pan"] as const) {
          const replay = replayGesture(trace, gesture, mode);
          for (const action of actionsOf(wheelSteps(replay.steps), "zoom")) {
            if (action.kind !== "zoom") continue;
            assert.ok(Math.abs(action.octaves) <= defaultCameraProfile.maxOctavesPerEvent + 1e-12);
          }
          for (const camera of [...replay.rig.frames(), replay.end]) assertFinite(camera);
          assert.equal(replay.rig.controller.motion(), "idle");
        }
      }
    });

    test("zoom mode zooms on every wheel event and pan mode pans on every unmodified one", () => {
      for (const gesture of trace.gestures) {
        const zoomed = replayGesture(trace, gesture, "zoom");
        for (const step of wheelSteps(zoomed.steps)) {
          const input = step.input as WheelInput;
          if (input.deltaY === 0 && input.deltaX === 0) continue;
          assert.ok(zoomOf(step), `${gesture.gesture} did not zoom in zoom mode`);
        }
        const panned = replayGesture(trace, gesture, "pan");
        for (const step of wheelSteps(panned.steps)) {
          const input = step.input as WheelInput;
          if (input.ctrlKey || input.metaKey) assert.ok(zoomOf(step));
          else assert.ok(panOf(step), `${gesture.gesture} did not pan in pan mode`);
        }
      }
    });
  });
}
