import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDetents,
  defaultCameraProfile,
  freshDetentState,
  type InputAction,
  type WheelInput,
  zoomForMagnification,
} from "../../src/index.ts";
import { createReplayRig, type ReplayRig } from "./replay.ts";

const viewport = { left: 0, top: 0, width: 800, height: 600 };
const micronsPerPixel = 0.25;
const noModifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
const detentZooms = [5, 10, 20, 40].map((magnification) =>
  zoomForMagnification(micronsPerPixel, magnification),
);

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

function pinch(deltaY: number): WheelInput {
  return wheel(deltaY, { ctrlKey: true });
}

function rigAt(zoom: number, enabled = true): ReplayRig {
  const holder: { rig?: ReplayRig } = {};
  const rig = createReplayRig(
    viewport,
    "zoom",
    {
      objectiveDetents: () =>
        enabled && holder.rig ? { zoom: holder.rig.controller.zoomGoal(), micronsPerPixel } : null,
      now: () => holder.rig?.time() ?? 0,
    },
    { x: 20_000, y: 15_000, zoom },
  );
  holder.rig = rig;
  return rig;
}

function goalOf(rig: ReplayRig): number {
  return rig.controller.zoomGoal();
}

function zoomOctaves(actions: readonly InputAction[]): number {
  return actions.reduce((sum, action) => sum + (action.kind === "zoom" ? action.octaves : 0), 0);
}

function approximately(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not ${expected}`);
}

test("the detent zooms match the objectives", () => {
  assert.deepEqual(
    detentZooms.map((zoom) => Math.round(zoom * 1000) / 1000),
    [-3, -2, -1, 0],
  );
});

test("mouse notches stop on each objective and release on continued zooming", () => {
  for (const detent of detentZooms) {
    const rig = rigAt(detent - 0.9);
    let time = 0;
    const notch = () => {
      time += 100;
      rig.feed(wheel(-100), time);
    };
    notch();
    notch();
    notch();
    approximately(goalOf(rig), detent);
    notch();
    approximately(goalOf(rig), detent);
    notch();
    assert.ok(goalOf(rig) > detent + 0.01, "the second continued notch releases the hold");
  }
});

test("a detent crossed zooming out holds and releases the same way", () => {
  const rig = rigAt(-1 + 0.9);
  let time = 0;
  const notch = () => {
    time += 100;
    rig.feed(wheel(100), time);
  };
  notch();
  notch();
  notch();
  approximately(goalOf(rig), -1);
  notch();
  approximately(goalOf(rig), -1);
  notch();
  assert.ok(goalOf(rig) < -1.01);
});

test("a trackpad pinch stops on the objective and releases after the release distance", () => {
  const rig = rigAt(-2.2);
  let time = 0;
  const goals: number[] = [];
  for (let index = 0; index < 40; index += 1) {
    time += 16;
    rig.feed(pinch(-4), time);
    goals.push(goalOf(rig));
  }
  const heldAt = goals.filter((goal) => Math.abs(goal - -2) < 1e-9).length;
  assert.ok(heldAt >= 8, `held for ${heldAt} events`);
  assert.ok((goals.at(-1) ?? -2) > -2 + 0.05);
  const travelledWhileHeld = heldAt * 4 * defaultCameraProfile.pinchOctavesPerPixel;
  assert.ok(travelledWhileHeld <= defaultCameraProfile.detentReleaseOctaves + 0.05);
});

test("the hold times out when the zoom pauses", () => {
  const rig = rigAt(-3.2);
  rig.feed(wheel(-100), 100);
  rig.feed(wheel(-100), 200);
  approximately(goalOf(rig), -3);
  rig.feed(wheel(-50), 200 + defaultCameraProfile.detentHoldMs + 50);
  assert.ok(goalOf(rig) > -3 + 0.05);
});

test("reversing the wheel leaves the detent at once", () => {
  const rig = rigAt(-3.2);
  rig.feed(wheel(-100), 100);
  approximately(goalOf(rig), -3);
  rig.feed(wheel(100), 160);
  assert.ok(goalOf(rig) < -3.05);
});

test("a step that starts on a detent heading away is not caught again", () => {
  const result = applyDetents(
    freshDetentState,
    { zoom: -2, micronsPerPixel },
    0.3,
    0,
    defaultCameraProfile,
  );
  approximately(result.octaves, 0.3);
  assert.equal(result.state.hold, null);
});

test("nothing changes when the setting is off", () => {
  const off = rigAt(-3.2, false);
  const baseline = createReplayRig(viewport, "zoom", {}, { x: 20_000, y: 15_000, zoom: -3.2 });
  let time = 0;
  for (let index = 0; index < 12; index += 1) {
    time += 100;
    const stepOff = off.feed(wheel(-100), time);
    const stepBaseline = baseline.feed(wheel(-100), time);
    assert.deepEqual(stepOff.actions, stepBaseline.actions);
  }
  assert.equal(goalOf(off), baseline.controller.zoomGoal());
});

test("double click and direct zoom calls ignore the hold", () => {
  const rig = rigAt(-3.2);
  rig.feed(wheel(-100), 100);
  approximately(goalOf(rig), -3);
  const step = rig.feed(
    { kind: "dblclick", clientX: 400, clientY: 300, button: 0, ...noModifiers },
    150,
  );
  approximately(zoomOctaves(step.actions), 1);
  rig.controller.zoomBy(0.25, undefined, { animate: false });
  approximately(goalOf(rig), -3 + 1 + 0.25, 1e-6);
});
