import type { Calibration } from "./calibration.ts";
import type { LegendContext, LegendDevice } from "./device-legend.ts";
import { type Intent, mapInput, type RawInput } from "./intents.ts";

export interface IntentPoint {
  readonly clientX: number;
  readonly clientY: number;
}

export interface TrackpadListenerOptions {
  readonly device: () => LegendDevice;
  readonly context: () => LegendContext;
  readonly calibration?: () => Calibration | undefined;
  readonly onIntent: (intent: Intent, at: IntentPoint) => void;
}

interface SafariGestureEvent extends Event {
  readonly scale: number;
  readonly clientX?: number;
  readonly clientY?: number;
}

const restingScale = 1;

export function bindTrackpadListeners(
  element: HTMLElement,
  options: TrackpadListenerOptions,
): () => void {
  let previousScale = restingScale;
  const mapOptions = () => {
    const calibration = options.calibration?.();
    return calibration === undefined ? {} : { calibration };
  };
  const emit = (raw: RawInput, at: IntentPoint) => {
    for (const intent of mapInput(options.device(), options.context(), raw, mapOptions())) {
      options.onIntent(intent, at);
    }
  };
  const centreOf = (): IntentPoint => {
    const box = element.getBoundingClientRect();
    return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
  };
  const pointOf = (event: SafariGestureEvent): IntentPoint =>
    typeof event.clientX === "number" && typeof event.clientY === "number"
      ? { clientX: event.clientX, clientY: event.clientY }
      : centreOf();

  const onPointerDown = (event: PointerEvent) => {
    emit(
      {
        kind: "pointer",
        button: event.button,
        ctrlKey: event.ctrlKey,
        pointerType: event.pointerType,
      },
      event,
    );
  };
  const onContextMenu = (event: MouseEvent) => {
    const pointer: RawInput = {
      kind: "pointer",
      button: event.button,
      ctrlKey: event.ctrlKey,
      pointerType: "mouse",
    };
    if (mapInput(options.device(), options.context(), pointer).length > 0) event.preventDefault();
  };
  const onGestureStart = (event: Event) => {
    event.preventDefault();
    previousScale = restingScale;
  };
  const onGestureChange = (event: Event) => {
    event.preventDefault();
    const gesture = event as SafariGestureEvent;
    emit({ kind: "safariPinch", previousScale, scale: gesture.scale }, pointOf(gesture));
    previousScale = gesture.scale;
  };
  const onGestureEnd = (event: Event) => {
    event.preventDefault();
    previousScale = restingScale;
  };

  element.addEventListener("pointerdown", onPointerDown, true);
  element.addEventListener("contextmenu", onContextMenu, true);
  element.addEventListener("gesturestart", onGestureStart);
  element.addEventListener("gesturechange", onGestureChange);
  element.addEventListener("gestureend", onGestureEnd);
  return () => {
    element.removeEventListener("pointerdown", onPointerDown, true);
    element.removeEventListener("contextmenu", onContextMenu, true);
    element.removeEventListener("gesturestart", onGestureStart);
    element.removeEventListener("gesturechange", onGestureChange);
    element.removeEventListener("gestureend", onGestureEnd);
  };
}
