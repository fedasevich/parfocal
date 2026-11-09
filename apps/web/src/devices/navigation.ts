import {
  type CameraProfile,
  type CameraProfilePreset,
  cameraProfiles,
  type WheelMode,
  type ZoomAnchor,
} from "@parfocal/viewer-engine";
import {
  type DeviceStorage,
  readDeviceSettings,
  writeDeviceSetting,
} from "../shell/device-settings.ts";
import { type Calibration, readCalibration } from "./calibration.ts";
import { calibratedProfile } from "./intents.ts";

export type WheelChoice = "detect" | "zoom" | "pan";

export type Navigation = {
  wheel: WheelChoice;
  invertZoom: boolean;
  feel: CameraProfilePreset;
  coasting: boolean;
  animatedJumps: boolean;
  zoomAnchor: ZoomAnchor;
  objectiveDetents: boolean;
};

export type NavigationOverride = "coasting" | "animatedJumps" | "zoomAnchor";

export const navigationEvent = "parfocal:navigation";

const keys = {
  wheel: "wheel_mode",
  invertZoom: "invert_zoom",
  feel: "camera_feel",
  coasting: "camera_coasting",
  animatedJumps: "camera_animated_jumps",
  zoomAnchor: "camera_zoom_anchor",
  objectiveDetents: "objective_detents",
} as const;

const feels = Object.keys(cameraProfiles) as CameraProfilePreset[];

export const feelDefaults = (feel: CameraProfilePreset) => {
  const profile = cameraProfiles[feel];
  return {
    coasting: profile.coastDecayMs > 0,
    animatedJumps: profile.longestFlightMs > 0,
    zoomAnchor: profile.zoomAnchor,
  };
};

const wheelChoices: WheelChoice[] = ["detect", "zoom", "pan"];

export function readNavigation(storage?: DeviceStorage): Navigation {
  const stored = readDeviceSettings(storage);
  const feel = feels.find((item) => item === stored[keys.feel]) ?? "smooth";
  const base = feelDefaults(feel);
  const anchor = stored[keys.zoomAnchor];
  const flag = (key: string, fallback: boolean) => {
    const value = stored[key];
    return typeof value === "boolean" ? value : fallback;
  };
  return {
    wheel: wheelChoices.find((item) => item === stored[keys.wheel]) ?? "detect",
    invertZoom: stored[keys.invertZoom] === true,
    feel,
    coasting: flag(keys.coasting, base.coasting),
    animatedJumps: flag(keys.animatedJumps, base.animatedJumps),
    zoomAnchor: anchor === "cursor" || anchor === "centre" ? anchor : base.zoomAnchor,
    objectiveDetents: stored[keys.objectiveDetents] === true,
  };
}

const announce = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(navigationEvent));
};

export function writeNavigation(change: Partial<Navigation>, storage?: DeviceStorage): void {
  for (const name of Object.keys(change) as (keyof Navigation)[]) {
    writeDeviceSetting(keys[name], change[name], storage);
  }
  announce();
}

export function chooseFeel(feel: CameraProfilePreset, storage?: DeviceStorage): void {
  const base = feelDefaults(feel);
  writeNavigation({ feel, ...base }, storage);
}

export function engineWheelMode(wheel: WheelChoice): WheelMode {
  return wheel === "detect" ? "auto" : wheel;
}

const lit = (preset: number, fallback: number) => (preset > 0 ? preset : fallback);

export function feelProfile(navigation: Navigation): CameraProfile {
  const preset = cameraProfiles[navigation.feel];
  const smooth = cameraProfiles.smooth;
  return {
    ...preset,
    coastDecayMs: navigation.coasting ? lit(preset.coastDecayMs, smooth.coastDecayMs) : 0,
    shortestFlightMs: navigation.animatedJumps
      ? lit(preset.shortestFlightMs, smooth.shortestFlightMs)
      : 0,
    longestFlightMs: navigation.animatedJumps
      ? lit(preset.longestFlightMs, smooth.longestFlightMs)
      : 0,
    zoomAnchor: navigation.zoomAnchor,
    wheelOctavesPerPixel: preset.wheelOctavesPerPixel * (navigation.invertZoom ? -1 : 1),
  };
}

export function navigationProfile(navigation: Navigation, calibration: Calibration): CameraProfile {
  return calibratedProfile(feelProfile(navigation), calibration);
}

export function currentProfile(storage?: DeviceStorage): CameraProfile {
  const stored = readDeviceSettings(storage)["device"];
  const device = typeof stored === "string" ? stored : "mouse";
  return navigationProfile(readNavigation(storage), readCalibration(device, storage));
}

export type PreviewMotion = {
  zoomMs: number;
  jumpMs: number;
  coastMs: number;
  anchor: ZoomAnchor;
  zoomOctavesPerNotch: number;
};

const previewNotchPixels = 100;

export function previewMotion(navigation: Navigation, reducedMotion = false): PreviewMotion {
  const profile = feelProfile(navigation);
  return {
    zoomMs: reducedMotion ? 0 : profile.zoomEaseMs,
    jumpMs: reducedMotion ? 0 : profile.longestFlightMs,
    coastMs: reducedMotion ? 0 : profile.coastDecayMs,
    anchor: profile.zoomAnchor,
    zoomOctavesPerNotch: -previewNotchPixels * profile.wheelOctavesPerPixel,
  };
}
