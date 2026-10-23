import { type FlightTiming, smoothFlightTiming } from "./flight.ts";
import {
  coastDecayMs,
  minimumThrowSpeed,
  releaseIdleMs,
  type ThrowFeel,
  velocityWindowMs,
  zoomEaseMs,
} from "./physics.ts";

export type ZoomAnchor = "cursor" | "centre";

export type WheelInputKind = "wheel" | "pinch";

export interface CameraProfile extends ThrowFeel, FlightTiming {
  readonly coastDecayMs: number;
  readonly zoomEaseMs: number;
  readonly wheelOctavesPerPixel: number;
  readonly pinchOctavesPerPixel: number;
  readonly maxOctavesPerEvent: number;
  readonly keyPanStepPx: number;
  readonly zoomAnchor: ZoomAnchor;
}

const pocWheelNatsPerPixel = 0.0022;
const pocPinchNatsPerPixel = 0.0075;
const pocKeyPanStepPx = 120;

const smooth: CameraProfile = {
  velocityWindowMs,
  releaseIdleMs,
  minimumThrowSpeed,
  coastDecayMs,
  zoomEaseMs,
  ...smoothFlightTiming,
  wheelOctavesPerPixel: pocWheelNatsPerPixel / Math.LN2,
  pinchOctavesPerPixel: pocPinchNatsPerPixel / Math.LN2,
  maxOctavesPerEvent: 0.5,
  keyPanStepPx: pocKeyPanStepPx,
  zoomAnchor: "cursor",
};

export function withoutMotion(profile: CameraProfile): CameraProfile {
  return {
    ...profile,
    coastDecayMs: 0,
    zoomEaseMs: 0,
    shortestFlightMs: 0,
    longestFlightMs: 0,
  };
}

const precise: CameraProfile = {
  ...smooth,
  coastDecayMs: 0,
  zoomEaseMs: smooth.zoomEaseMs / 2,
  shortestFlightMs: smooth.shortestFlightMs / 2,
  longestFlightMs: smooth.longestFlightMs / 2,
};

export const cameraProfiles = {
  smooth,
  precise,
  instant: withoutMotion(smooth),
} as const satisfies Record<string, CameraProfile>;

export type CameraProfilePreset = keyof typeof cameraProfiles;

export const defaultCameraProfile: CameraProfile = cameraProfiles.smooth;

export function coasts(profile: CameraProfile): boolean {
  return profile.coastDecayMs > 0;
}

export function easesZoom(profile: CameraProfile): boolean {
  return profile.zoomEaseMs > 0;
}

export function flies(profile: CameraProfile): boolean {
  return profile.longestFlightMs > 0;
}

export function wheelZoomOctaves(
  profile: CameraProfile,
  travelPixels: number,
  kind: WheelInputKind,
): number {
  if (!Number.isFinite(travelPixels)) return 0;
  const rate = kind === "pinch" ? profile.pinchOctavesPerPixel : profile.wheelOctavesPerPixel;
  const cap = Math.max(0, profile.maxOctavesPerEvent);
  return Math.min(cap, Math.max(-cap, -travelPixels * rate));
}
