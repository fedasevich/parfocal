import { useEffect } from "react";
import { createCameraInput } from "../devices/camera-input.ts";
import { legendDeviceOf } from "../devices/device-legend.ts";
import { bindGamepadWhenConnected, deviceIntentEvent } from "../devices/gamepad-source.ts";
import { dispatchIntentKey, steppedPreset } from "../devices/intent-keys.ts";
import { bindSpaceMouse, type HidLike, hasWebHid } from "../devices/spacemouse-source.ts";
import { mainCalibration } from "../devices/stage-calibration.ts";
import { bindTrackpadListeners } from "../devices/trackpad-listeners.ts";
import { readDeviceSettings } from "../shell/device-settings.ts";
import type { ViewerModule } from "./magnification-control.tsx";
import type { ViewerEngine } from "./viewer-engine.ts";
import type { SlideWorkspace } from "./workspace.ts";

type DeviceSession = { readonly engine: ViewerEngine; readonly module: ViewerModule };

const focused = () => document.hasFocus() && document.visibilityState === "visible";

export function useStageDevices(
  session: DeviceSession | null,
  hostNode: HTMLDivElement | null,
  chosenDevice: ReturnType<typeof readDeviceSettings>["device"],
  workspace: SlideWorkspace,
) {
  const context = workspace === "annotate" ? "annotate" : "review";

  useEffect(() => {
    const surface = hostNode?.parentElement;
    if (session === null || !hostNode || !surface) return;
    return bindTrackpadListeners(surface, {
      device: () => legendDeviceOf(chosenDevice),
      context: () => context,
      calibration: mainCalibration,
      onIntent: (intent, at) => {
        hostNode.dataset["trackpadIntent"] = intent.kind;
        if (intent.kind === "zoom") {
          session.engine.zoomBy(intent.octaves, at, { animate: intent.animate });
        }
      },
    });
  }, [session, hostNode, chosenDevice, context]);

  useEffect(() => {
    if (session === null || typeof navigator === "undefined" || !("getGamepads" in navigator)) {
      return;
    }
    const input = createCameraInput({
      device: () => legendDeviceOf(chosenDevice),
      context: () => context,
      calibration: mainCalibration,
      camera: session.engine,
      onIntent: (intent) => {
        if (intent.kind === "presetStep") {
          const spacing = session.engine.getSlide()?.micronsPerPixel ?? null;
          const current = session.module.effectiveMagnification(
            session.engine.getCamera().zoom,
            spacing,
          );
          if (current !== null) {
            session.engine.zoomToMagnification(steppedPreset(current, intent.step));
          }
          return;
        }
        if (dispatchIntentKey(intent, window)) return;
        window.dispatchEvent(new CustomEvent(deviceIntentEvent, { detail: intent }));
      },
    });
    return bindGamepadWhenConnected(
      input,
      {
        getPads: () => navigator.getGamepads(),
        frames: {
          request: (cb) => requestAnimationFrame(cb),
          cancel: (id) => cancelAnimationFrame(id),
        },
        now: () => performance.now(),
        focused,
      },
      window,
    );
  }, [session, chosenDevice, context]);

  useEffect(() => {
    if (session === null || typeof navigator === "undefined" || !hasWebHid(navigator)) return;
    const input = createCameraInput({
      device: () => legendDeviceOf(chosenDevice),
      context: () => context,
      calibration: mainCalibration,
      camera: session.engine,
      onIntent: (intent) => {
        window.dispatchEvent(new CustomEvent(deviceIntentEvent, { detail: intent }));
      },
    });
    return bindSpaceMouse(input, {
      hid: (navigator as unknown as { hid: HidLike }).hid,
      now: () => performance.now(),
      focused,
      rotation: () => readDeviceSettings().spaceMouseRotation === true,
    });
  }, [session, chosenDevice, context]);
}
