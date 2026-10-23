import { type CameraProfile, defaultCameraProfile } from "../camera/profile.ts";
import {
  classifyWheel,
  freshWheelClassifier,
  type WheelClassifier,
  type WheelDevice,
  type WheelMode,
  wheelIntent,
} from "./wheel.ts";

export interface InputPoint {
  readonly clientX: number;
  readonly clientY: number;
}

export interface InputModifiers {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

export interface PointerSampleInput extends InputPoint {
  readonly ageMs: number;
}

export type PointerInputKind = "down" | "move" | "up" | "cancel" | "lostcapture";

export interface PointerInput extends InputPoint, InputModifiers {
  readonly kind: PointerInputKind;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
  readonly samples?: readonly PointerSampleInput[];
}

export interface WheelInput extends InputPoint, InputModifiers {
  readonly kind: "wheel";
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
}

export interface DoubleClickInput extends InputPoint, InputModifiers {
  readonly kind: "dblclick";
  readonly button: number;
}

export interface BlurInput {
  readonly kind: "blur";
}

export type ViewerInput = PointerInput | WheelInput | DoubleClickInput | BlurInput;

export type CursorState = "idle" | "active";

export type InputAction =
  | { readonly kind: "startDrag"; readonly at: InputPoint }
  | { readonly kind: "dragTo"; readonly at: InputPoint; readonly ageMs: number }
  | { readonly kind: "endDrag" }
  | { readonly kind: "abandonDrag" }
  | { readonly kind: "pan"; readonly dx: number; readonly dy: number }
  | {
      readonly kind: "zoom";
      readonly octaves: number;
      readonly at: InputPoint;
      readonly animate: boolean;
    }
  | { readonly kind: "capture"; readonly pointerId: number }
  | { readonly kind: "release"; readonly pointerId: number }
  | { readonly kind: "cursor"; readonly cursor: CursorState }
  | { readonly kind: "preventDefault" };

export interface GestureHooks {
  readonly primaryDragPans?: (input: PointerInput) => boolean;
  readonly panModifierHeld?: () => boolean;
  readonly hitsEditableShape?: (at: InputPoint) => boolean;
  readonly cameraProfile?: () => CameraProfile;
}

export interface GestureInterpreter {
  readonly handle: (input: ViewerInput) => readonly InputAction[];
  readonly wheelMode: () => WheelMode;
  readonly setWheelMode: (mode: WheelMode) => void;
  readonly wheelDevice: () => WheelDevice;
  readonly activePointers: () => number;
  readonly gesture: () => "none" | "drag" | "pinch";
}

export const primaryButton = 0;
export const middleButton = 1;
export const doubleClickOctaves = 1;

interface Pinch {
  readonly distance: number;
  readonly mid: InputPoint;
}

type Gesture =
  | { readonly kind: "none" }
  | { readonly kind: "drag"; readonly pointerId: number }
  | { readonly kind: "pinch"; readonly pinch: Pinch };

const noGesture: Gesture = { kind: "none" };

function point(input: InputPoint): InputPoint {
  return { clientX: input.clientX, clientY: input.clientY };
}

function pinchOf(a: InputPoint, b: InputPoint): Pinch {
  return {
    distance: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
    mid: { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 },
  };
}

export function createGestureInterpreter(
  hooks: GestureHooks = {},
  initialMode: WheelMode = "auto",
): GestureInterpreter {
  const primaryDragPans = hooks.primaryDragPans ?? (() => true);
  const panModifierHeld = hooks.panModifierHeld ?? (() => false);
  const hitsEditableShape = hooks.hitsEditableShape ?? (() => false);
  const cameraProfile = hooks.cameraProfile ?? (() => defaultCameraProfile);

  const pointers = new Map<number, InputPoint>();
  let gesture: Gesture = noGesture;
  let mode = initialMode;
  let classifier: WheelClassifier = freshWheelClassifier;

  const twoPointers = (): readonly [InputPoint, InputPoint] | null => {
    const [a, b] = [...pointers.values()];
    return a && b ? [a, b] : null;
  };

  const beginDrag = (input: PointerInput): InputAction[] => {
    gesture = { kind: "drag", pointerId: input.pointerId };
    return [
      { kind: "startDrag", at: point(input) },
      { kind: "capture", pointerId: input.pointerId },
      { kind: "cursor", cursor: "active" },
    ];
  };

  const endEverything = (): InputAction[] => {
    const active = gesture.kind !== "none";
    const tracked = [...pointers.keys()];
    pointers.clear();
    gesture = noGesture;
    if (!active) return [];
    return [
      { kind: "abandonDrag" },
      ...tracked.map((pointerId): InputAction => ({ kind: "release", pointerId })),
      { kind: "cursor", cursor: "idle" },
    ];
  };

  const down = (input: PointerInput): InputAction[] => {
    const mouse = input.pointerType === "mouse";
    if (mouse && input.button === middleButton) {
      if (pointers.size > 0) return [{ kind: "preventDefault" }];
      pointers.set(input.pointerId, point(input));
      return [{ kind: "preventDefault" }, ...beginDrag(input)];
    }
    if (mouse && input.button !== primaryButton) return [];
    if (pointers.size === 0 && !panModifierHeld() && !primaryDragPans(input)) return [];
    if (pointers.size >= 2 || pointers.has(input.pointerId)) return [];
    pointers.set(input.pointerId, point(input));
    if (pointers.size === 1) return beginDrag(input);
    const pair = twoPointers();
    if (!pair) return [];
    gesture = { kind: "pinch", pinch: pinchOf(...pair) };
    return [{ kind: "abandonDrag" }, { kind: "capture", pointerId: input.pointerId }];
  };

  const movePinch = (pinch: Pinch): InputAction[] => {
    const pair = twoPointers();
    if (!pair) return [];
    const next = pinchOf(...pair);
    gesture = { kind: "pinch", pinch: next };
    const actions: InputAction[] = [
      {
        kind: "pan",
        dx: next.mid.clientX - pinch.mid.clientX,
        dy: next.mid.clientY - pinch.mid.clientY,
      },
    ];
    if (pinch.distance > 0 && next.distance > 0 && next.distance !== pinch.distance) {
      actions.push({
        kind: "zoom",
        octaves: Math.log2(next.distance / pinch.distance),
        at: next.mid,
        animate: false,
      });
    }
    return actions;
  };

  const move = (input: PointerInput): InputAction[] => {
    if (!pointers.has(input.pointerId)) return [];
    if (input.pointerType === "mouse" && input.buttons === 0) return endEverything();
    pointers.set(input.pointerId, point(input));
    if (gesture.kind === "pinch") return movePinch(gesture.pinch);
    if (gesture.kind !== "drag" || gesture.pointerId !== input.pointerId) return [];
    const samples = input.samples && input.samples.length > 0 ? input.samples : [];
    const actions: InputAction[] = samples.map((sample) => ({
      kind: "dragTo",
      at: point(sample),
      ageMs: sample.ageMs,
    }));
    const last = samples.at(-1);
    if (!last || last.clientX !== input.clientX || last.clientY !== input.clientY) {
      actions.push({ kind: "dragTo", at: point(input), ageMs: 0 });
    }
    return actions;
  };

  const up = (input: PointerInput): InputAction[] => {
    if (!pointers.delete(input.pointerId)) return [];
    const release: InputAction = { kind: "release", pointerId: input.pointerId };
    if (gesture.kind === "pinch") {
      const [remainingId, remaining] = [...pointers.entries()][0] ?? [];
      if (remainingId === undefined || !remaining) {
        gesture = noGesture;
        return [release, { kind: "cursor", cursor: "idle" }];
      }
      gesture = { kind: "drag", pointerId: remainingId };
      return [release, { kind: "startDrag", at: remaining }];
    }
    if (gesture.kind === "drag" && gesture.pointerId === input.pointerId) {
      gesture = noGesture;
      pointers.clear();
      return [{ kind: "endDrag" }, release, { kind: "cursor", cursor: "idle" }];
    }
    return [release];
  };

  const wheel = (input: WheelInput): InputAction[] => {
    classifier = classifyWheel(classifier, input);
    const intent = wheelIntent(mode, classifier.device, input, cameraProfile());
    const actions: InputAction[] = [{ kind: "preventDefault" }];
    if (intent.kind === "pan") {
      if (gesture.kind === "none" && (intent.dx !== 0 || intent.dy !== 0)) {
        actions.push({ kind: "pan", dx: intent.dx, dy: intent.dy });
      }
      return actions;
    }
    if (intent.octaves === 0) return actions;
    const dragging = gesture.kind === "drag" ? pointers.get(gesture.pointerId) : undefined;
    if (gesture.kind === "pinch") return actions;
    actions.push({
      kind: "zoom",
      octaves: intent.octaves,
      at: point(input),
      animate: intent.animate && !dragging,
    });
    if (dragging) actions.push({ kind: "startDrag", at: dragging });
    return actions;
  };

  const doubleClick = (input: DoubleClickInput): InputAction[] => {
    if (input.button !== primaryButton) return [];
    const at = point(input);
    if (hitsEditableShape(at)) return [];
    return [
      { kind: "preventDefault" },
      {
        kind: "zoom",
        octaves: input.altKey ? -doubleClickOctaves : doubleClickOctaves,
        at,
        animate: true,
      },
    ];
  };

  const handle = (input: ViewerInput): readonly InputAction[] => {
    switch (input.kind) {
      case "down":
        return down(input);
      case "move":
        return move(input);
      case "up":
        return up(input);
      case "cancel":
      case "lostcapture":
        return pointers.has(input.pointerId) ? endEverything() : [];
      case "wheel":
        return wheel(input);
      case "dblclick":
        return doubleClick(input);
      case "blur":
        return endEverything();
    }
  };

  return {
    handle,
    wheelMode: () => mode,
    setWheelMode: (next) => {
      mode = next;
      classifier = freshWheelClassifier;
    },
    wheelDevice: () => classifier.device,
    activePointers: () => pointers.size,
    gesture: () => gesture.kind,
  };
}
