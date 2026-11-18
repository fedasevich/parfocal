import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDeadZone,
  calibrationDefaults,
  calibrationRanges,
  readCalibration,
  writeCalibration,
} from "../src/devices/calibration.ts";
import { chooseFeel, type Navigation, readNavigation } from "../src/devices/navigation.ts";
import {
  freshWheelState,
  previewMagnification,
  previewWheel,
  stickPan,
  throwOf,
} from "../src/screens/settings/feel-model.ts";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

const base = (): Navigation => readNavigation(memory());

const notch = (deltaY: number) => ({
  deltaX: 0,
  deltaY,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
});

test("each slider spans its real range and the default sits inside it", () => {
  for (const key of ["deadZone", "speed"] as const) {
    const range = calibrationRanges[key];
    assert.ok(range.min < range.max);
    assert.ok(calibrationDefaults[key] >= range.min && calibrationDefaults[key] <= range.max);
    assert.equal((range.max - range.min) % range.step, 0);
  }
  assert.deepEqual(calibrationRanges.deadZone, { min: 0, max: 50, step: 5 });
  assert.deepEqual(calibrationRanges.speed, { min: 10, max: 200, step: 10 });
});

test("a saved calibration is held to the slider range", () => {
  const storage = memory();
  writeCalibration("spacemouse", { deadZone: 90, speed: 5 }, storage);
  assert.deepEqual(readCalibration("spacemouse", storage), { deadZone: 50, speed: 10 });
  writeCalibration("spacemouse", { deadZone: -4, speed: 500 }, storage);
  assert.deepEqual(readCalibration("spacemouse", storage), { deadZone: 0, speed: 200 });
});

test("a dead zone of 20 percent sits at two fifths of its track", () => {
  const { min, max } = calibrationRanges.deadZone;
  assert.equal((20 - min) / (max - min), 0.4);
});

test("the wheel zooms further at a higher speed and the other way when inverted", () => {
  const navigation = base();
  const slow = previewWheel(
    freshWheelState,
    navigation,
    { deadZone: 10, speed: 30 },
    notch(-100),
    0,
  );
  const fast = previewWheel(
    freshWheelState,
    navigation,
    { deadZone: 10, speed: 120 },
    notch(-100),
    0,
  );
  assert.ok(slow.zoomed > 0);
  assert.ok(fast.zoomed > slow.zoomed);
  const flipped = previewWheel(
    freshWheelState,
    { ...navigation, invertZoom: true },
    calibrationDefaults,
    notch(-100),
    0,
  );
  assert.ok(flipped.state.octaves === 0 && flipped.zoomed === 0);
  const flippedOut = previewWheel(
    { ...freshWheelState, octaves: 1 },
    { ...navigation, invertZoom: true },
    calibrationDefaults,
    notch(-100),
    0,
  );
  assert.ok(flippedOut.zoomed < 0);
});

test("a wheel set to pan moves the grid and scales with the speed", () => {
  const navigation: Navigation = { ...base(), wheel: "pan" };
  const slow = previewWheel(
    freshWheelState,
    navigation,
    { deadZone: 10, speed: 30 },
    notch(100),
    0,
  );
  const fast = previewWheel(
    freshWheelState,
    navigation,
    { deadZone: 10, speed: 120 },
    notch(100),
    0,
  );
  assert.equal(slow.zoomed, 0);
  assert.ok(Math.abs(fast.panDy) > Math.abs(slow.panDy));
});

test("objective detents hold the zoom at the next objective", () => {
  const navigation: Navigation = { ...base(), objectiveDetents: true };
  const near = { ...freshWheelState, octaves: 0.7 };
  const first = previewWheel(near, navigation, calibrationDefaults, notch(-400), 0);
  assert.ok(Math.abs(previewMagnification(first.state.octaves) - 10) < 0.01);
  const held = previewWheel(first.state, navigation, calibrationDefaults, notch(-40), 50);
  assert.equal(held.zoomed, 0);
  const free = previewWheel(
    near,
    { ...navigation, objectiveDetents: false },
    calibrationDefaults,
    notch(-400),
    0,
  );
  assert.notEqual(Math.round(previewMagnification(free.state.octaves)), 10);
});

test("the stick ignores a push inside the dead zone and moves faster at a higher speed", () => {
  const inside = stickPan({ deadZone: 30, speed: 60 }, { x: 0.25, y: 0 });
  assert.deepEqual(inside, { dx: 0, dy: 0 });
  const small = stickPan({ deadZone: 10, speed: 60 }, { x: 0.8, y: 0 });
  assert.ok(small.dx > 0);
  assert.ok(stickPan({ deadZone: 10, speed: 120 }, { x: 0.8, y: 0 }).dx > small.dx);
  assert.equal(applyDeadZone(0.25, 30), 0);
});

test("coasting adds a glide after a drag only when it is on", () => {
  const samples = [
    { x: 0, y: 0, time: 0 },
    { x: 20, y: 0, time: 30 },
    { x: 40, y: 0, time: 60 },
  ];
  const storage = memory();
  chooseFeel("smooth", storage);
  const smooth = readNavigation(storage);
  const thrown = throwOf(samples, 70, smooth, calibrationDefaults);
  assert.ok(thrown !== null && thrown.dx > 0);
  assert.equal(throwOf(samples, 70, { ...smooth, coasting: false }, calibrationDefaults), null);
  chooseFeel("instant", storage);
  assert.equal(throwOf(samples, 70, readNavigation(storage), calibrationDefaults), null);
});
