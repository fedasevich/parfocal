import type { CameraProfile } from "../camera/profile.ts";
import type { InteractionSignal } from "../engine/interaction-signal.ts";
import type { Cancel } from "../engine/scheduling.ts";
import type { ClientPoint } from "../engine/types.ts";
import {
  type CursorState,
  createGestureInterpreter,
  doubleClickOctaves,
  type GestureHooks,
  type InputAction,
  type InputModifiers,
  middleButton,
  type PointerInput,
  type PointerInputKind,
  type PointerSampleInput,
  type ViewerInput,
} from "./gestures.ts";
import { touchTuning } from "./touch.ts";
import type { WheelDevice, WheelMode } from "./wheel.ts";

export interface InputTarget {
  readonly startDrag: (at: ClientPoint) => void;
  readonly dragTo: (at: ClientPoint, ageMs?: number) => void;
  readonly endDrag: () => void;
  readonly stopMotion: () => void;
  readonly panBy: (dx: number, dy: number) => void;
  readonly zoomBy: (
    octaves: number,
    at?: ClientPoint,
    options?: { readonly animate?: boolean },
  ) => void;
  readonly zoomToMagnification?: (
    magnification: number,
    at?: ClientPoint,
    options?: { readonly animate?: boolean },
  ) => boolean;
  readonly flyToFit?: () => Promise<unknown>;
  readonly fitToSlide?: () => void;
  readonly getCameraProfile?: () => CameraProfile;
  readonly interaction?: InteractionSignal;
}

export interface ViewerInputOptions extends GestureHooks {
  readonly wheelMode?: WheelMode;
  readonly cursors?: Readonly<Record<CursorState, string>>;
  readonly onInput?: (input: ViewerInput, actions: readonly InputAction[]) => void;
  readonly interaction?: InteractionSignal;
}

export interface ViewerInputBinding {
  readonly wheelMode: () => WheelMode;
  readonly setWheelMode: (mode: WheelMode) => void;
  readonly wheelDevice: () => WheelDevice;
  readonly gesture: () => "none" | "drag" | "pinch";
  readonly setCursors: (cursors: Readonly<Record<CursorState, string>>) => void;
  readonly dispose: () => void;
}

export const defaultCursors: Readonly<Record<CursorState, string>> = {
  idle: "grab",
  active: "grabbing",
};

const pointerKinds: ReadonlyArray<readonly [string, PointerInputKind]> = [
  ["pointermove", "move"],
  ["pointerup", "up"],
  ["pointercancel", "cancel"],
];

function modifiers(event: MouseEvent): InputModifiers {
  return {
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
  };
}

function coalescedSamples(event: PointerEvent): readonly PointerSampleInput[] {
  if (typeof event.getCoalescedEvents !== "function") return [];
  return event.getCoalescedEvents().map((sample) => ({
    clientX: sample.clientX,
    clientY: sample.clientY,
    ageMs: Math.max(0, event.timeStamp - sample.timeStamp),
  }));
}

function pointerInput(kind: PointerInputKind, event: PointerEvent): PointerInput {
  const base = {
    kind,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    buttons: event.buttons,
    timeMs: event.timeStamp,
    clientX: event.clientX,
    clientY: event.clientY,
    ...modifiers(event),
  };
  return kind === "move" ? { ...base, samples: coalescedSamples(event) } : base;
}

export function bindViewerInput(
  element: HTMLElement,
  target: InputTarget,
  options: ViewerInputOptions = {},
): ViewerInputBinding {
  const cameraProfile = options.cameraProfile ?? target.getCameraProfile;
  const interpreter = createGestureInterpreter(
    cameraProfile ? { ...options, cameraProfile } : options,
    options.wheelMode ?? "auto",
  );
  const view = element.ownerDocument.defaultView ?? globalThis;
  const root = element.ownerDocument.documentElement;
  let cursors = options.cursors ?? defaultCursors;
  let cursor: CursorState = "idle";
  const interaction = options.interaction ?? target.interaction;
  let releaseGesture: Cancel | null = null;
  let lastTouchMs = Number.NEGATIVE_INFINITY;
  const guardMs = (options.touchTuning ?? touchTuning).syntheticDoubleClickGuardMs;

  const savedStyle = {
    touchAction: element.style.touchAction,
    userSelect: element.style.userSelect,
    cursor: element.style.cursor,
    overscroll: root.style.overscrollBehavior,
  };
  element.style.touchAction = "none";
  element.style.userSelect = "none";
  element.style.setProperty("-webkit-user-select", "none");
  element.style.cursor = cursors.idle;
  root.style.overscrollBehavior = "none";

  const apply = (action: InputAction, event: Event | null) => {
    switch (action.kind) {
      case "startDrag":
        target.startDrag(action.at);
        return;
      case "dragTo":
        target.dragTo(action.at, action.ageMs);
        return;
      case "endDrag":
        target.endDrag();
        return;
      case "abandonDrag":
        target.stopMotion();
        return;
      case "pan":
        target.panBy(action.dx, action.dy);
        return;
      case "zoom":
        target.zoomBy(action.octaves, action.at, { animate: action.animate });
        return;
      case "magnify":
        if (!target.zoomToMagnification?.(action.magnification, action.at, { animate: true })) {
          target.zoomBy(doubleClickOctaves, action.at, { animate: true });
        }
        return;
      case "fitSlide":
        if (target.flyToFit) void target.flyToFit();
        else target.fitToSlide?.();
        return;
      case "capture":
        try {
          element.setPointerCapture(action.pointerId);
        } catch {
          return;
        }
        return;
      case "release":
        try {
          if (element.hasPointerCapture(action.pointerId)) {
            element.releasePointerCapture(action.pointerId);
          }
        } catch {
          return;
        }
        return;
      case "cursor":
        cursor = action.cursor;
        element.style.cursor = cursors[cursor];
        return;
      case "preventDefault":
        if (event?.cancelable) event.preventDefault();
        return;
    }
  };

  const followGesture = (actions: readonly InputAction[]) => {
    if (!interaction) return;
    if (actions.some((action) => action.kind === "pan" || action.kind === "zoom")) {
      interaction.pulse();
    }
    const gesturing = interpreter.gesture() !== "none";
    if (gesturing && releaseGesture === null) releaseGesture = interaction.hold();
    if (!gesturing && releaseGesture !== null) {
      releaseGesture();
      releaseGesture = null;
    }
  };

  const feed = (input: ViewerInput, event: Event | null) => {
    if (input.kind === "dblclick" && event) {
      const afterTouch = event.timeStamp - lastTouchMs < guardMs;
      if (afterTouch) return;
    }
    if (input.kind === "down" || input.kind === "up") {
      if (input.pointerType === "touch" && event) lastTouchMs = event.timeStamp;
    }
    const actions = interpreter.handle(input);
    options.onInput?.(input, actions);
    for (const action of actions) apply(action, event);
    followGesture(actions);
  };

  const removers: Array<() => void> = [];
  const listen = <E extends Event>(
    on: EventTarget,
    type: string,
    handler: (event: E) => void,
    listenerOptions?: AddEventListenerOptions,
  ) => {
    const wrapped = (event: Event) => handler(event as E);
    on.addEventListener(type, wrapped, listenerOptions);
    removers.push(() => on.removeEventListener(type, wrapped, listenerOptions));
  };

  listen<PointerEvent>(element, "pointerdown", (event) => feed(pointerInput("down", event), event));
  for (const [type, kind] of pointerKinds) {
    listen<PointerEvent>(view, type, (event) => feed(pointerInput(kind, event), event));
  }
  listen<PointerEvent>(element, "lostpointercapture", (event) =>
    feed(pointerInput("lostcapture", event), event),
  );
  listen<WheelEvent>(
    element,
    "wheel",
    (event) =>
      feed(
        {
          kind: "wheel",
          clientX: event.clientX,
          clientY: event.clientY,
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaMode: event.deltaMode,
          ...modifiers(event),
        },
        event,
      ),
    { passive: false },
  );
  listen<MouseEvent>(element, "dblclick", (event) =>
    feed(
      {
        kind: "dblclick",
        clientX: event.clientX,
        clientY: event.clientY,
        button: event.button,
        ...modifiers(event),
      },
      event,
    ),
  );
  for (const type of ["mousedown", "auxclick"]) {
    listen<MouseEvent>(element, type, (event) => {
      if (event.button === middleButton) event.preventDefault();
    });
  }
  listen<MouseEvent>(element, "contextmenu", (event) => {
    if (interpreter.gesture() !== "none") event.preventDefault();
  });
  listen(view, "blur", () => feed({ kind: "blur" }, null));
  listen(element.ownerDocument, "visibilitychange", () => {
    if (element.ownerDocument.visibilityState === "hidden") feed({ kind: "blur" }, null);
  });

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    feed({ kind: "blur" }, null);
    for (const remove of removers) remove();
    removers.length = 0;
    element.style.touchAction = savedStyle.touchAction;
    element.style.userSelect = savedStyle.userSelect;
    element.style.removeProperty("-webkit-user-select");
    element.style.cursor = savedStyle.cursor;
    root.style.overscrollBehavior = savedStyle.overscroll;
  };

  return {
    wheelMode: interpreter.wheelMode,
    setWheelMode: interpreter.setWheelMode,
    wheelDevice: interpreter.wheelDevice,
    gesture: interpreter.gesture,
    setCursors: (next) => {
      cursors = next;
      element.style.cursor = cursors[cursor];
    },
    dispose,
  };
}
