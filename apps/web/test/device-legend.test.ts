import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deviceNames,
  footswitchDefaultKey,
  legendContexts,
  legendDeviceOf,
  legendDevices,
  legendRows,
} from "../src/devices/device-legend.ts";
import { keyAction } from "../src/screens/settings/keymap.ts";

test("every device has a name and four rows in every context", () => {
  for (const device of legendDevices) {
    assert.ok(deviceNames[device].length > 0);
    for (const context of legendContexts) {
      const rows = legendRows[device][context];
      assert.equal(rows.length, 4, `${device} ${context}`);
      for (const [action, control] of rows) assert.ok(action.length > 0 && control.length > 0);
    }
  }
});

test("an unknown stored device falls back to the mouse", () => {
  assert.equal(legendDeviceOf("gamepad"), "gamepad");
  assert.equal(legendDeviceOf("joystick"), "mouse");
  assert.equal(legendDeviceOf(undefined), "mouse");
});

test("a footswitch sending its default key maps to the next cell action", () => {
  assert.deepEqual(keyAction("dnext").keys, [footswitchDefaultKey]);
  assert.deepEqual(legendRows.footswitch.review[0], ["Next cell", footswitchDefaultKey]);
});
