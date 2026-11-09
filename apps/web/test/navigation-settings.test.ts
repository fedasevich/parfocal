import assert from "node:assert/strict";
import { test } from "node:test";
import { cameraProfiles, wheelZoomOctaves } from "@parfocal/viewer-engine";
import { writeCalibration } from "../src/devices/calibration.ts";
import {
  chooseFeel,
  currentProfile,
  engineWheelMode,
  feelProfile,
  navigationProfile,
  previewMotion,
  readNavigation,
  writeNavigation,
} from "../src/devices/navigation.ts";
import { writeDeviceSetting } from "../src/shell/device-settings.ts";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

test("nothing saved means smooth, cursor anchor, detect wheel and no detents", () => {
  const navigation = readNavigation(memory());
  assert.equal(navigation.feel, "smooth");
  assert.equal(navigation.wheel, "detect");
  assert.equal(navigation.zoomAnchor, "cursor");
  assert.equal(navigation.coasting, true);
  assert.equal(navigation.animatedJumps, true);
  assert.equal(navigation.invertZoom, false);
  assert.equal(navigation.objectiveDetents, false);
});

test("each setting is saved and read back", () => {
  const storage = memory();
  writeNavigation(
    {
      wheel: "pan",
      invertZoom: true,
      coasting: false,
      animatedJumps: false,
      zoomAnchor: "centre",
      objectiveDetents: true,
    },
    storage,
  );
  const navigation = readNavigation(storage);
  assert.equal(navigation.wheel, "pan");
  assert.equal(navigation.invertZoom, true);
  assert.equal(navigation.coasting, false);
  assert.equal(navigation.animatedJumps, false);
  assert.equal(navigation.zoomAnchor, "centre");
  assert.equal(navigation.objectiveDetents, true);
});

test("a corrupt value falls back to the default", () => {
  const storage = memory();
  writeDeviceSetting("camera_feel", "wobbly", storage);
  writeDeviceSetting("wheel_mode", 3, storage);
  writeDeviceSetting("camera_zoom_anchor", "corner", storage);
  const navigation = readNavigation(storage);
  assert.equal(navigation.feel, "smooth");
  assert.equal(navigation.wheel, "detect");
  assert.equal(navigation.zoomAnchor, "cursor");
});

test("choosing a feel resets the overrides to that feel", () => {
  const storage = memory();
  writeNavigation({ coasting: false, zoomAnchor: "centre" }, storage);
  chooseFeel("precise", storage);
  const navigation = readNavigation(storage);
  assert.equal(navigation.feel, "precise");
  assert.equal(navigation.coasting, false);
  assert.equal(navigation.animatedJumps, true);
  assert.equal(navigation.zoomAnchor, "cursor");
  chooseFeel("instant", storage);
  assert.equal(readNavigation(storage).animatedJumps, false);
});

test("the three feels build the three engine presets", () => {
  for (const feel of ["smooth", "precise", "instant"] as const) {
    const storage = memory();
    chooseFeel(feel, storage);
    assert.deepEqual(feelProfile(readNavigation(storage)), cameraProfiles[feel]);
  }
});

test("each override changes only its own part of the profile", () => {
  const smooth = cameraProfiles.smooth;
  const base = readNavigation(memory());
  assert.equal(feelProfile({ ...base, coasting: false }).coastDecayMs, 0);
  assert.equal(feelProfile({ ...base, coasting: false }).longestFlightMs, smooth.longestFlightMs);
  const still = feelProfile({ ...base, animatedJumps: false });
  assert.equal(still.longestFlightMs, 0);
  assert.equal(still.shortestFlightMs, 0);
  assert.equal(still.coastDecayMs, smooth.coastDecayMs);
  assert.equal(feelProfile({ ...base, zoomAnchor: "centre" }).zoomAnchor, "centre");
});

test("turning coasting on under Instant brings back the Smooth glide", () => {
  const storage = memory();
  chooseFeel("instant", storage);
  writeNavigation({ coasting: true }, storage);
  assert.equal(
    feelProfile(readNavigation(storage)).coastDecayMs,
    cameraProfiles.smooth.coastDecayMs,
  );
});

test("inverting zoom flips the wheel direction and leaves pinch alone", () => {
  const base = readNavigation(memory());
  const normal = feelProfile(base);
  const inverted = feelProfile({ ...base, invertZoom: true });
  assert.ok(wheelZoomOctaves(normal, -100, "wheel") > 0);
  assert.ok(wheelZoomOctaves(inverted, -100, "wheel") < 0);
  assert.equal(inverted.pinchOctavesPerPixel, normal.pinchOctavesPerPixel);
});

test("the detect choice hands the engine its automatic wheel mode", () => {
  assert.equal(engineWheelMode("detect"), "auto");
  assert.equal(engineWheelMode("zoom"), "zoom");
  assert.equal(engineWheelMode("pan"), "pan");
});

test("speed is kept per device and the main device decides which one drives the viewer", () => {
  const storage = memory();
  writeCalibration("mouse", { speed: 120 }, storage);
  writeCalibration("trackpad", { speed: 30 }, storage);
  const smooth = cameraProfiles.smooth;
  assert.equal(currentProfile(storage).wheelOctavesPerPixel, smooth.wheelOctavesPerPixel * 2);
  writeDeviceSetting("device", "trackpad", storage);
  assert.equal(currentProfile(storage).wheelOctavesPerPixel, smooth.wheelOctavesPerPixel * 0.5);
  writeDeviceSetting("device", "pen", storage);
  assert.equal(currentProfile(storage).wheelOctavesPerPixel, smooth.wheelOctavesPerPixel);
});

test("speed and feel combine in one profile", () => {
  const base = readNavigation(memory());
  const profile = navigationProfile(
    { ...base, feel: "precise", coasting: false },
    {
      speed: 120,
      deadZone: 10,
    },
  );
  assert.equal(profile.coastDecayMs, 0);
  assert.equal(profile.wheelOctavesPerPixel, cameraProfiles.precise.wheelOctavesPerPixel * 2);
});

test("the preview follows the chosen feel and stands still under reduced motion", () => {
  const base = readNavigation(memory());
  const smooth = previewMotion(base);
  assert.equal(smooth.zoomMs, cameraProfiles.smooth.zoomEaseMs);
  assert.ok(smooth.coastMs > 0);
  assert.ok(smooth.zoomOctavesPerNotch < 0);
  const precise = previewMotion({ ...base, feel: "precise", coasting: false });
  assert.equal(precise.coastMs, 0);
  assert.ok(precise.zoomMs < smooth.zoomMs);
  const instant = previewMotion({
    ...base,
    feel: "instant",
    coasting: false,
    animatedJumps: false,
  });
  assert.equal(instant.zoomMs, 0);
  assert.equal(instant.jumpMs, 0);
  const reduced = previewMotion(base, true);
  assert.equal(reduced.zoomMs + reduced.jumpMs + reduced.coastMs, 0);
  assert.equal(previewMotion({ ...base, zoomAnchor: "centre" }).anchor, "centre");
  assert.ok(previewMotion({ ...base, invertZoom: true }).zoomOctavesPerNotch > 0);
});
