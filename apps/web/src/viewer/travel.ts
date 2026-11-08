import type { Camera, FlightEnd, SlideArea } from "@parfocal/viewer-engine";
import { areaCamera } from "@parfocal/viewer-engine";

export type TravelKey = "skip" | "cancel" | "ignore";

export type TravelKeyInput = {
  key: string;
  repeat: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
};

const modifierKeys = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "AltGraph"]);

export function travelKey(input: TravelKeyInput): TravelKey {
  if (modifierKeys.has(input.key) || input.repeat) return "ignore";
  if (input.key === "]" && !input.ctrlKey && !input.metaKey && !input.altKey) return "skip";
  return "cancel";
}

export type TravelState = {
  object: string;
  from: readonly [number, number];
  to: readonly [number, number];
};

export type TravelEngine = {
  getCamera: () => Camera;
  getCameraBounds: () => Parameters<typeof areaCamera>[2];
  stopMotion: () => void;
  setCamera: (camera: Camera) => void;
  flyToArea: (area: SlideArea) => Promise<FlightEnd>;
};

export type TravelOptions = {
  viewport: () => { width: number; height: number };
  onArrive?: (object: string, end: "arrived" | "skipped") => void;
};

export const centreOf = (area: SlideArea): readonly [number, number] => [
  area.x + area.width / 2,
  area.y + area.height / 2,
];

export function createTravel(engine: TravelEngine, options: TravelOptions) {
  let state: TravelState | null = null;
  let area: SlideArea | null = null;
  let token = 0;
  const listeners = new Set<() => void>();
  const publish = (next: TravelState | null) => {
    state = next;
    for (const listener of listeners) listener();
  };

  const start = (object: string, target: SlideArea) => {
    token += 1;
    const mine = token;
    const camera = engine.getCamera();
    const to = centreOf(target);
    area = target;
    publish({
      object,
      from: [camera.x, camera.y],
      to,
    });
    return engine.flyToArea(target).then((end) => {
      if (mine !== token || state === null) return end;
      area = null;
      publish(null);
      if (end === "arrived") options.onArrive?.(object, "arrived");
      return end;
    });
  };

  const finish = () => {
    token += 1;
    area = null;
    publish(null);
  };

  const press = (input: TravelKeyInput): TravelKey => {
    if (state === null || area === null) return "ignore";
    const kind = travelKey(input);
    if (kind === "ignore") return kind;
    const { object } = state;
    engine.stopMotion();
    if (kind === "skip") {
      engine.setCamera(areaCamera(area, options.viewport(), engine.getCameraBounds()));
      finish();
      options.onArrive?.(object, "skipped");
    } else {
      finish();
    }
    return kind;
  };

  return {
    start,
    press,
    get: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type Travel = ReturnType<typeof createTravel>;
