import type { CameraProfile } from "@parfocal/viewer-engine";
import { readDeviceSettings } from "../shell/device-settings.ts";
import { type Calibration, readCalibration } from "./calibration.ts";
import { calibratedProfile } from "./intents.ts";

export const defaultMainDevice = "mouse";

export function mainDevice(): string {
  const chosen = readDeviceSettings()["device"];
  return typeof chosen === "string" ? chosen : defaultMainDevice;
}

export function mainCalibration(): Calibration {
  return readCalibration(mainDevice());
}

type ProfiledEngine = {
  readonly getCameraProfile: () => CameraProfile;
  readonly setCameraProfile: (profile: CameraProfile) => void;
};

export function applyMainCalibration(engine: ProfiledEngine): void {
  engine.setCameraProfile(calibratedProfile(engine.getCameraProfile(), mainCalibration()));
}
