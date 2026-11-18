import {
  effectiveMotionMode,
  type MotionMode,
  motionModes,
  reducedMotionQuery,
} from "@parfocal/tokens";
import { type DeviceStorage, readDeviceSettings, writeDeviceSetting } from "./device-settings.ts";

export type MotionChoice = MotionMode;

const key = "motion";

export function readMotion(storage?: DeviceStorage): MotionChoice {
  const stored = (storage === undefined ? readDeviceSettings() : readDeviceSettings(storage))[key];
  return motionModes.find((mode) => mode === stored) ?? "normal";
}

export function applyMotion(choice: MotionChoice, root: HTMLElement = document.documentElement) {
  root.dataset["motion"] = choice;
}

export function chooseMotion(choice: MotionChoice): void {
  writeDeviceSetting(key, choice);
  applyMotion(choice);
}

export function installMotion(): void {
  applyMotion(readMotion());
}

export function motionIsReduced(): boolean {
  if (typeof document === "undefined") return false;
  const asked = document.documentElement.dataset["motion"];
  const mode = motionModes.find((item) => item === asked) ?? "normal";
  const prefersReduced =
    typeof window.matchMedia === "function" && window.matchMedia(reducedMotionQuery).matches;
  return effectiveMotionMode(mode, prefersReduced) === "reduced";
}
