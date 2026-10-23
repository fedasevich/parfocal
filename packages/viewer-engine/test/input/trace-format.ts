export type TraceDevice = "mouse" | "trackpad";

export type TraceOrigin = "synthetic" | "recorded";

export type TraceGestureName =
  | "scroll-down"
  | "scroll-up"
  | "scroll-sideways"
  | "pinch-out"
  | "pinch-in"
  | "ctrl-wheel"
  | "shift-wheel"
  | "drag"
  | "middle-drag"
  | "double-click"
  | "alt-double-click";

export const traceGestureNames: readonly TraceGestureName[] = [
  "scroll-down",
  "scroll-up",
  "scroll-sideways",
  "pinch-out",
  "pinch-in",
  "ctrl-wheel",
  "shift-wheel",
  "drag",
  "middle-drag",
  "double-click",
  "alt-double-click",
];

interface TraceModifiers {
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export interface TraceWheelEvent extends TraceModifiers {
  readonly type: "wheel";
  readonly t: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
}

export interface TracePointerEvent extends TraceModifiers {
  readonly type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel";
  readonly t: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly pointerId: number;
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
}

export interface TraceDoubleClickEvent extends TraceModifiers {
  readonly type: "dblclick";
  readonly t: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly button: number;
}

export type TraceEvent = TraceWheelEvent | TracePointerEvent | TraceDoubleClickEvent;

export interface TraceGesture {
  readonly gesture: TraceGestureName;
  readonly events: readonly TraceEvent[];
}

export interface InputTrace {
  readonly schema: 1;
  readonly origin: TraceOrigin;
  readonly device: TraceDevice;
  readonly label: string;
  readonly os: string;
  readonly browser: string;
  readonly devicePixelRatio: number;
  readonly viewport: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly basis?: string;
  readonly todo?: string;
  readonly userAgent?: string;
  readonly gestures: readonly TraceGesture[];
}
