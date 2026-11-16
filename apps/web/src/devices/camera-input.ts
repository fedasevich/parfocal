import type { Calibration } from "./calibration.ts";
import type { LegendContext, LegendDevice } from "./device-legend.ts";
import { type Intent, mapInput, type RawInput } from "./intents.ts";

export const railPanPixelsPerSecond = 900;
export const railZoomOctavesPerSecond = 1.5;
export const longestInputFrameMs = 100;

export type CameraTarget = {
  readonly panBy: (dx: number, dy: number) => void;
  readonly zoomBy: (octaves: number, at: undefined, options: { animate: boolean }) => void;
};

export type CameraInputOptions = {
  readonly device: () => LegendDevice;
  readonly context: () => LegendContext;
  readonly calibration?: () => Calibration | undefined;
  readonly camera: CameraTarget;
  readonly onIntent?: (intent: Intent) => void;
};

export type CameraInput = {
  readonly push: (raw: RawInput, elapsedMs: number) => void;
};

export function createCameraInput(options: CameraInputOptions): CameraInput {
  const push = (raw: RawInput, elapsedMs: number) => {
    const seconds = Math.min(longestInputFrameMs, Math.max(0, elapsedMs)) / 1000;
    const calibration = options.calibration?.();
    const mapOptions = calibration === undefined ? {} : { calibration };
    for (const intent of mapInput(options.device(), options.context(), raw, mapOptions)) {
      if (intent.kind === "pan" && intent.unit === "rate") {
        const pixels = railPanPixelsPerSecond * seconds;
        options.camera.panBy(intent.dx * pixels, intent.dy * pixels);
      } else if (intent.kind === "zoom" && !intent.animate) {
        options.camera.zoomBy(intent.octaves * railZoomOctavesPerSecond * seconds, undefined, {
          animate: false,
        });
      }
      options.onIntent?.(intent);
    }
  };
  return { push };
}
