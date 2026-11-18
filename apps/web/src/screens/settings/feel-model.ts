import {
  applyDetents,
  classifyWheel,
  coastDistance,
  type DetentState,
  flightDurationMs,
  freshDetentState,
  freshWheelClassifier,
  magnificationAtZoom,
  type PointerSample,
  releaseVelocity,
  type WheelClassifier,
  type WheelDelta,
  wheelIntent,
  zoomForMagnification,
} from "@parfocal/viewer-engine";
import { type Calibration, speedFactor } from "../../devices/calibration.ts";
import { railPanPixelsPerSecond } from "../../devices/camera-input.ts";
import { mapInput } from "../../devices/intents.ts";
import { engineWheelMode, type Navigation, navigationProfile } from "../../devices/navigation.ts";

export const previewMicronsPerPixel = 0.25;
export const previewStartMagnification = 5;
export const previewMaxOctaves = 3;
export const previewCoastReach = 4;

const startZoom = zoomForMagnification(previewMicronsPerPixel, previewStartMagnification);

export const previewMagnification = (octaves: number): number =>
  magnificationAtZoom(previewMicronsPerPixel, startZoom + octaves);

export type WheelState = {
  classifier: WheelClassifier;
  detents: DetentState;
  octaves: number;
};

export const freshWheelState: WheelState = {
  classifier: freshWheelClassifier,
  detents: freshDetentState,
  octaves: 0,
};

export type WheelResult = { state: WheelState; zoomed: number; panDx: number; panDy: number };

export type PreviewWheel = WheelDelta & { shiftKey: boolean };

export function previewWheel(
  state: WheelState,
  navigation: Navigation,
  calibration: Calibration,
  input: PreviewWheel,
  nowMs: number,
): WheelResult {
  const profile = navigationProfile(navigation, calibration);
  const classifier = classifyWheel(state.classifier, input);
  const intent = wheelIntent(engineWheelMode(navigation.wheel), classifier.device, input, profile);
  if (intent.kind === "pan") {
    const factor = speedFactor(calibration.speed);
    return {
      state: { ...state, classifier },
      zoomed: 0,
      panDx: intent.dx * factor,
      panDy: intent.dy * factor,
    };
  }
  const asked = navigation.objectiveDetents
    ? applyDetents(
        state.detents,
        { zoom: startZoom + state.octaves, micronsPerPixel: previewMicronsPerPixel },
        intent.octaves,
        nowMs,
        profile,
      )
    : { octaves: intent.octaves, state: freshDetentState };
  const octaves = Math.max(0, Math.min(previewMaxOctaves, state.octaves + asked.octaves));
  return {
    state: { classifier, detents: asked.state, octaves },
    zoomed: octaves - state.octaves,
    panDx: 0,
    panDy: 0,
  };
}

export type Stick = { x: number; y: number };

export function stickPan(calibration: Calibration, stick: Stick): { dx: number; dy: number } {
  const intents = mapInput(
    "spacemouse",
    "read",
    { kind: "axes", x: stick.x, y: stick.y, zoom: 0 },
    { calibration },
  );
  for (const intent of intents) {
    if (intent.kind === "pan") {
      return {
        dx: intent.dx * railPanPixelsPerSecond,
        dy: intent.dy * railPanPixelsPerSecond,
      };
    }
  }
  return { dx: 0, dy: 0 };
}

export function throwOf(
  samples: readonly PointerSample[],
  releaseMs: number,
  navigation: Navigation,
  calibration: Calibration,
): { dx: number; dy: number; ms: number } | null {
  const profile = navigationProfile(navigation, calibration);
  if (profile.coastDecayMs <= 0) return null;
  const velocity = releaseVelocity(samples, releaseMs, profile);
  if (velocity === null) return null;
  const reach = coastDistance(velocity, profile.coastDecayMs);
  return { dx: reach.x, dy: reach.y, ms: profile.coastDecayMs * previewCoastReach };
}

export function jumpMs(navigation: Navigation, calibration: Calibration, length: number): number {
  return flightDurationMs(length, navigationProfile(navigation, calibration));
}
