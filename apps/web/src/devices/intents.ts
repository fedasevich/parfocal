import {
  type CameraProfile,
  defaultCameraProfile,
  isTwoFingerClick,
  safariPinchOctaves,
  type WheelDevice,
  type WheelMode,
  wheelIntent,
} from "@parfocal/viewer-engine";
import {
  applyDeadZone,
  type Calibration,
  calibrationDefaults,
  speedFactor,
} from "./calibration.ts";
import { footswitchDefaultKey, type LegendContext, type LegendDevice } from "./device-legend.ts";

export type CellType = 1 | 2 | 3 | 4;

export type Intent =
  | { kind: "pan"; dx: number; dy: number; unit: "pixels" | "rate" }
  | { kind: "zoom"; octaves: number; animate: boolean }
  | { kind: "nextCell" }
  | { kind: "previousCell" }
  | { kind: "keep" }
  | { kind: "setType"; type: CellType }
  | { kind: "notACell" }
  | { kind: "nextArea" }
  | { kind: "previousArea" }
  | { kind: "peek"; held: boolean }
  | { kind: "presetStep"; step: 1 | -1 }
  | { kind: "preset"; digit: number }
  | { kind: "magnification"; value: number }
  | { kind: "negativePoint" };

export type IntentKind = Intent["kind"];

export type WheelRaw = {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

type KeyRaw = { kind: "key"; key: string; shift?: boolean; alt?: boolean; held?: boolean };

type WheelEventRaw = { kind: "wheel"; mode: WheelMode; wheelDevice: WheelDevice; input: WheelRaw };

type AxesRaw = { kind: "axes"; x: number; y: number; zoom: number };

type PointerRaw = {
  kind: "pointer";
  button: number;
  ctrlKey: boolean;
  pointerType: string;
};

type PinchRaw = { kind: "safariPinch"; previousScale: number; scale: number };

export type RawInput =
  | KeyRaw
  | PointerRaw
  | PinchRaw
  | WheelEventRaw
  | AxesRaw
  | { kind: "button"; name: string }
  | { kind: "gesture"; name: string };

export type MapOptions = {
  calibration?: Calibration;
  footswitchKey?: string;
};

export const keyZoomOctaves = 0.5;
export const keyPanFastFactor = 3;
export const peekPullThreshold = 0.95;
export const penDoubleTapMagnification = 40;

const none: Intent[] = [];

const panKeys: Record<string, [number, number]> = {
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
  ArrowLeft: [1, 0],
  ArrowRight: [-1, 0],
};

const typeOf = (key: string): CellType | null => {
  const digit = Number(key);
  return Number.isInteger(digit) && digit >= 1 && digit <= 4 ? (digit as CellType) : null;
};

const viewKey = (raw: KeyRaw): Intent[] => {
  const { key, shift, alt } = raw;
  const pan = panKeys[key];
  if (pan) {
    const factor = shift ? keyPanFastFactor : 1;
    return [{ kind: "pan", dx: pan[0] * factor, dy: pan[1] * factor, unit: "rate" }];
  }
  if (key === "+" || key === "=") return [{ kind: "zoom", octaves: keyZoomOctaves, animate: true }];
  if (key === "-" || key === "_") {
    return [{ kind: "zoom", octaves: -keyZoomOctaves, animate: true }];
  }
  if (alt && /^[1-6]$/.test(key)) return [{ kind: "preset", digit: Number(key) }];
  if (key === "]") return [{ kind: "nextArea" }];
  if (key === "[") return [{ kind: "previousArea" }];
  if (key.toLowerCase() === "z") return [{ kind: "peek", held: raw.held ?? true }];
  return none;
};

const reviewKey = (raw: KeyRaw): Intent[] => {
  const key = raw.key.toLowerCase();
  if (key === "j") return [{ kind: raw.shift ? "previousCell" : "nextCell" }];
  if (key === "k") return [{ kind: "keep" }];
  if (key === "x") return [{ kind: "notACell" }];
  const type = raw.alt ? null : typeOf(raw.key);
  if (type) return [{ kind: "setType", type }];
  return viewKey(raw);
};

const keyIntents = (context: LegendContext, raw: KeyRaw): Intent[] =>
  context === "review" ? reviewKey(raw) : viewKey(raw);

const retypeKey = (raw: KeyRaw): Intent[] => {
  const type = typeOf(raw.key);
  return type ? [{ kind: "setType", type }] : none;
};

const footswitchIntents = (context: LegendContext, raw: KeyRaw, footswitchKey: string) => {
  const key = raw.key.toLowerCase();
  if (context === "review") {
    if (key === footswitchKey.toLowerCase()) {
      return [{ kind: raw.shift ? "previousCell" : "nextCell" }] as Intent[];
    }
    return key === "k" ? [{ kind: "keep" } as Intent] : none;
  }
  if (context === "read") {
    if (raw.key === "]") return [{ kind: "nextArea" } as Intent];
    if (raw.key === "[") return [{ kind: "previousArea" } as Intent];
  }
  return none;
};

type ByContext = Partial<Record<LegendContext, Intent>>;

const penGestures: Record<LegendContext, Record<string, Intent>> = {
  read: {
    "double-tap": { kind: "magnification", value: penDoubleTapMagnification },
    "two-finger-double-tap": { kind: "peek", held: true },
  },
  review: {
    "swipe-sheet": { kind: "nextCell" },
    "keep-button": { kind: "keep" },
    "not-a-cell-button": { kind: "notACell" },
    "type-button-1": { kind: "setType", type: 1 },
    "type-button-2": { kind: "setType", type: 2 },
    "type-button-3": { kind: "setType", type: 3 },
    "type-button-4": { kind: "setType", type: 4 },
  },
  annotate: {},
};

const presetNext: Intent = { kind: "presetStep", step: 1 };
const presetPrevious: Intent = { kind: "presetStep", step: -1 };

const spaceMouseButtons: Record<string, ByContext> = {
  left: { review: { kind: "nextCell" } },
  right: { review: { kind: "keep" } },
  "side-next": { read: presetNext, annotate: presetNext },
  "side-previous": { read: presetPrevious, annotate: presetPrevious },
};

const gamepadButtons: Record<string, ByContext> = {
  a: { review: { kind: "keep" } },
  b: { review: { kind: "nextCell" } },
  x: { review: { kind: "notACell" } },
  start: { read: { kind: "nextArea" } },
  "shoulder-right": { read: presetNext, annotate: presetNext },
  "shoulder-left": { read: presetPrevious, annotate: presetPrevious },
  "dpad-up": { review: { kind: "setType", type: 1 } },
  "dpad-right": { review: { kind: "setType", type: 2 } },
  "dpad-down": { review: { kind: "setType", type: 3 } },
  "dpad-left": { review: { kind: "setType", type: 4 } },
};

const lookup = (table: Record<string, ByContext>, name: string, context: LegendContext) => {
  const intent = table[name]?.[context];
  return intent ? [intent] : none;
};

export function calibratedProfile(profile: CameraProfile, calibration: Calibration): CameraProfile {
  const factor = speedFactor(calibration.speed);
  if (factor === 1) return profile;
  return {
    ...profile,
    wheelOctavesPerPixel: profile.wheelOctavesPerPixel * factor,
    pinchOctavesPerPixel: profile.pinchOctavesPerPixel * factor,
  };
}

const wheelIntents = (raw: WheelEventRaw, calibration: Calibration): Intent[] => {
  const intent = wheelIntent(
    raw.mode,
    raw.wheelDevice,
    raw.input,
    calibratedProfile(defaultCameraProfile, calibration),
  );
  if (intent.kind === "zoom") {
    return intent.octaves === 0 ? none : [{ ...intent }];
  }
  const factor = speedFactor(calibration.speed);
  const dx = intent.dx * factor;
  const dy = intent.dy * factor;
  return dx === 0 && dy === 0 ? none : [{ kind: "pan", dx, dy, unit: "pixels" }];
};

const axesIntents = (raw: AxesRaw, calibration: Calibration, pullsToPeek: boolean): Intent[] => {
  const factor = speedFactor(calibration.speed);
  const scaled = (axis: number) => applyDeadZone(axis, calibration.deadZone) * factor;
  const intents: Intent[] = [];
  const dx = scaled(raw.x);
  const dy = scaled(raw.y);
  if (dx !== 0 || dy !== 0) intents.push({ kind: "pan", dx, dy, unit: "rate" });
  const zoom = scaled(raw.zoom);
  if (zoom !== 0) intents.push({ kind: "zoom", octaves: zoom, animate: false });
  if (pullsToPeek && raw.zoom <= -peekPullThreshold) intents.push({ kind: "peek", held: true });
  return intents;
};

export function mapInput(
  device: LegendDevice,
  context: LegendContext,
  raw: RawInput,
  options: MapOptions = {},
): Intent[] {
  const calibration = options.calibration ?? calibrationDefaults;
  if (raw.kind === "wheel") {
    return device === "mouse" || device === "trackpad" ? wheelIntents(raw, calibration) : none;
  }
  if (raw.kind === "pointer") {
    const clicks = device === "trackpad" || device === "mouse";
    return clicks && context === "annotate" && isTwoFingerClick(raw)
      ? [{ kind: "negativePoint" }]
      : none;
  }
  if (raw.kind === "safariPinch") {
    if (device !== "trackpad") return none;
    const octaves = safariPinchOctaves(
      raw.previousScale,
      raw.scale,
      calibratedProfile(defaultCameraProfile, calibration),
    );
    return octaves === 0 ? none : [{ kind: "zoom", octaves, animate: false }];
  }
  if (raw.kind === "axes") {
    if (device !== "spacemouse" && device !== "gamepad") return none;
    return axesIntents(raw, calibration, device === "spacemouse" && context === "read");
  }
  if (raw.kind === "button") {
    if (device === "spacemouse") return lookup(spaceMouseButtons, raw.name, context);
    if (device === "gamepad") return lookup(gamepadButtons, raw.name, context);
    return none;
  }
  if (raw.kind === "gesture") {
    const intent = device === "pen" ? penGestures[context][raw.name] : undefined;
    return intent ? [intent] : none;
  }
  if (device === "footswitch") {
    return footswitchIntents(context, raw, options.footswitchKey ?? footswitchDefaultKey);
  }
  if (device === "spacemouse") return context === "review" ? retypeKey(raw) : none;
  if (device === "mouse" || device === "trackpad" || device === "keyboard") {
    return keyIntents(context, raw);
  }
  return none;
}
