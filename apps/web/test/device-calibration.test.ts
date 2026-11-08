import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyDeadZone,
  calibrationDefaults,
  readCalibration,
  speedFactor,
  writeCalibration,
} from "../src/devices/calibration.ts";
import { readDeviceSettings } from "../src/shell/device-settings.ts";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

test("a device never calibrated gets the defaults", () => {
  assert.deepEqual(readCalibration("gamepad", memory()), calibrationDefaults);
});

test("calibration is stored per device and read back", () => {
  const storage = memory();
  writeCalibration("gamepad", { deadZone: 25, speed: 90 }, storage);
  writeCalibration("spacemouse", { speed: 30 }, storage);
  assert.deepEqual(readCalibration("gamepad", storage), { deadZone: 25, speed: 90 });
  assert.deepEqual(readCalibration("spacemouse", storage), { deadZone: 10, speed: 30 });
  assert.deepEqual(readCalibration("mouse", storage), calibrationDefaults);
});

test("calibration keeps other device settings", () => {
  const storage = memory();
  storage.setItem("parfocal.device-settings", JSON.stringify({ theme: "dark" }));
  writeCalibration("pen", { deadZone: 5 }, storage);
  assert.equal(readDeviceSettings(storage).theme, "dark");
});

test("calibration clamps values and ignores corrupt entries", () => {
  const storage = memory();
  assert.deepEqual(writeCalibration("pen", { deadZone: 400, speed: -5 }, storage), {
    deadZone: 50,
    speed: 10,
  });
  storage.setItem("parfocal.device-settings", JSON.stringify({ calibration: { pen: "bad" } }));
  assert.deepEqual(readCalibration("pen", storage), calibrationDefaults);
});

test("the dead zone rescales an axis", () => {
  assert.equal(applyDeadZone(0.05, 10), 0);
  assert.equal(applyDeadZone(-0.1, 10), 0);
  assert.equal(applyDeadZone(1, 10), 1);
  assert.ok(Math.abs(applyDeadZone(-0.55, 10) + 0.5) < 1e-9);
});

test("speed is scaled against the default", () => {
  assert.equal(speedFactor(60), 1);
  assert.equal(speedFactor(120), 2);
});
