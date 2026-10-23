import { type CameraProfile, defaultCameraProfile, wheelZoomOctaves } from "../camera/profile.ts";

export type WheelMode = "auto" | "zoom" | "pan";

export type WheelDevice = "mouse" | "trackpad";

export interface WheelDelta {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export interface WheelClassifier {
  readonly device: WheelDevice;
  readonly mouseEvidence: number;
}

export type WheelIntent =
  | { readonly kind: "zoom"; readonly octaves: number; readonly animate: boolean }
  | { readonly kind: "pan"; readonly dx: number; readonly dy: number };

export const wheelLinePixels = 16;
export const wheelPagePixels = 400;
export const macMouseWheelStep = 4.000244140625;
export const mouseNotchMinimum = 50;
export const trackpadDeltaMaximum = 4;
export const mouseEvidenceNeeded = 2;
export const pinchDeltaMaximum = 40;

const pixelMode = 0;
const lineMode = 1;

export const freshWheelClassifier: WheelClassifier = { device: "mouse", mouseEvidence: 0 };

export function wheelPixels(deltaMode: number): number {
  if (deltaMode === lineMode) return wheelLinePixels;
  return deltaMode === pixelMode ? 1 : wheelPagePixels;
}

export function isMacMouseStep(delta: number): boolean {
  return delta !== 0 && delta % macMouseWheelStep === 0;
}

export function isPinchWheel(input: WheelDelta): boolean {
  if (!input.ctrlKey || input.deltaMode !== pixelMode || isMacMouseStep(input.deltaY)) {
    return false;
  }
  return !Number.isInteger(input.deltaY) || Math.abs(input.deltaY) < pinchDeltaMaximum;
}

function mainDelta(input: WheelDelta): number {
  return input.deltaY !== 0 ? input.deltaY : input.deltaX;
}

function looksLikeTrackpad(input: WheelDelta): boolean {
  const delta = mainDelta(input);
  if (input.deltaMode !== pixelMode || isMacMouseStep(delta)) return false;
  if (input.deltaX !== 0 && input.deltaY !== 0) return true;
  if (!Number.isInteger(delta)) return true;
  return delta !== 0 && Math.abs(delta) < trackpadDeltaMaximum;
}

function looksLikeMouse(input: WheelDelta): boolean {
  if (input.deltaMode !== pixelMode) return true;
  if (input.deltaX !== 0 && input.deltaY !== 0) return false;
  const delta = mainDelta(input);
  if (isMacMouseStep(delta)) return true;
  return Number.isInteger(delta) && Math.abs(delta) >= mouseNotchMinimum;
}

export function classifyWheel(state: WheelClassifier, input: WheelDelta): WheelClassifier {
  if (input.ctrlKey || input.metaKey) return state;
  if (looksLikeTrackpad(input)) return { device: "trackpad", mouseEvidence: 0 };
  if (!looksLikeMouse(input)) return state;
  const definite = input.deltaMode !== pixelMode || isMacMouseStep(mainDelta(input));
  const mouseEvidence = state.mouseEvidence + 1;
  const device = definite || mouseEvidence >= mouseEvidenceNeeded ? "mouse" : state.device;
  return { device, mouseEvidence };
}

export function wheelEventOctaves(
  input: WheelDelta,
  profile: CameraProfile = defaultCameraProfile,
): { octaves: number; animate: boolean } {
  const pinch = isPinchWheel(input);
  const travel = mainDelta(input) * wheelPixels(input.deltaMode);
  return {
    octaves: wheelZoomOctaves(profile, travel, pinch ? "pinch" : "wheel"),
    animate: !pinch,
  };
}

export function wheelPan(input: WheelDelta & { readonly shiftKey: boolean }): {
  dx: number;
  dy: number;
} {
  const pixels = wheelPixels(input.deltaMode);
  const travel = (delta: number) => (delta === 0 ? 0 : -delta * pixels);
  if (input.shiftKey && input.deltaX === 0) return { dx: travel(input.deltaY), dy: 0 };
  return { dx: travel(input.deltaX), dy: travel(input.deltaY) };
}

export function wheelIntent(
  mode: WheelMode,
  device: WheelDevice,
  input: WheelDelta & { readonly shiftKey: boolean },
  profile: CameraProfile = defaultCameraProfile,
): WheelIntent {
  const zooms =
    input.ctrlKey || input.metaKey || mode === "zoom" || (mode === "auto" && device === "mouse");
  if (!zooms) return { kind: "pan", ...wheelPan(input) };
  return { kind: "zoom", ...wheelEventOctaves(input, profile) };
}
