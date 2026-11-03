import type { DeviceProfile, TraceStep } from "./steps.ts";
import type {
  InputTrace,
  TraceDoubleClickEvent,
  TraceEvent,
  TraceGesture,
  TraceGestureEvent,
  TracePointerEvent,
  TraceWheelEvent,
} from "./trace-format.ts";

export interface Timing {
  readonly countdownMs: number;
  readonly recordMs: number;
}

export const defaultTiming: Timing = { countdownMs: 3000, recordMs: 5000 };

export type Moment =
  | { readonly kind: "countdown"; readonly remainingMs: number }
  | { readonly kind: "recording"; readonly elapsedMs: number; readonly remainingMs: number }
  | { readonly kind: "finished" };

export function momentAt(elapsedMs: number, timing: Timing): Moment {
  if (elapsedMs < timing.countdownMs) {
    return { kind: "countdown", remainingMs: timing.countdownMs - elapsedMs };
  }
  const recorded = elapsedMs - timing.countdownMs;
  if (recorded < timing.recordMs) {
    return { kind: "recording", elapsedMs: recorded, remainingMs: timing.recordMs - recorded };
  }
  return { kind: "finished" };
}

export function timingFromSearch(search: string): Timing {
  const params = new URLSearchParams(search);
  const seconds = (name: string, fallback: number) => {
    const value = Number(params.get(name));
    return params.has(name) && Number.isFinite(value) && value > 0 ? value * 1000 : fallback;
  };
  return {
    countdownMs: seconds("countdown", defaultTiming.countdownMs),
    recordMs: seconds("record", defaultTiming.recordMs),
  };
}

interface ModifierSource {
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

interface PointSource extends ModifierSource {
  readonly timeStamp: number;
  readonly clientX: number;
  readonly clientY: number;
}

function modifiers(event: ModifierSource) {
  return {
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
  };
}

export function wheelRecord(
  event: PointSource & Pick<WheelEvent, "deltaX" | "deltaY" | "deltaMode">,
): TraceWheelEvent {
  return {
    type: "wheel",
    t: event.timeStamp,
    clientX: event.clientX,
    clientY: event.clientY,
    deltaX: event.deltaX,
    deltaY: event.deltaY,
    deltaMode: event.deltaMode,
    ...modifiers(event),
  };
}

export function pointerRecord(
  type: TracePointerEvent["type"],
  event: PointSource & Pick<PointerEvent, "pointerId" | "pointerType" | "button" | "buttons">,
): TracePointerEvent {
  return {
    type,
    t: event.timeStamp,
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button: event.button,
    buttons: event.buttons,
    ...modifiers(event),
  };
}

export function doubleClickRecord(
  event: PointSource & Pick<MouseEvent, "button">,
): TraceDoubleClickEvent {
  return {
    type: "dblclick",
    t: event.timeStamp,
    clientX: event.clientX,
    clientY: event.clientY,
    button: event.button,
    ...modifiers(event),
  };
}

export function gestureRecord(
  type: TraceGestureEvent["type"],
  event: PointSource & { readonly scale: number; readonly rotation: number },
): TraceGestureEvent {
  return {
    type,
    t: event.timeStamp,
    clientX: event.clientX,
    clientY: event.clientY,
    scale: event.scale,
    rotation: event.rotation,
    ...modifiers(event),
  };
}

const tenthOfMillisecond = 10;

function rebased<T extends { readonly t: number }>(events: readonly T[], origin: number): T[] {
  return events.map((event) => ({
    ...event,
    t: Math.round((event.t - origin) * tenthOfMillisecond) / tenthOfMillisecond,
  }));
}

export function finishGesture(
  step: TraceStep,
  events: readonly TraceEvent[],
  gestureEvents: readonly TraceGestureEvent[],
): TraceGesture | null {
  const all = [...events, ...gestureEvents];
  if (all.length === 0) return null;
  const origin = Math.min(...all.map((event) => event.t));
  return {
    gesture: step.gesture,
    ...(step.variant === undefined ? {} : { variant: step.variant }),
    events: rebased(events, origin),
    ...(gestureEvents.length === 0 ? {} : { gestureEvents: rebased(gestureEvents, origin) }),
  };
}

export function describeAgent(userAgent: string): { os: string; browser: string } {
  const os = /Mac OS X/.test(userAgent)
    ? "macOS"
    : /Windows/.test(userAgent)
      ? "Windows"
      : /Linux/.test(userAgent)
        ? "Linux"
        : "unknown";
  const browser = /Firefox\//.test(userAgent)
    ? "Firefox"
    : /Edg\//.test(userAgent)
      ? "Edge"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "unknown";
  return { os, browser };
}

export interface RecordingEnvironment {
  readonly userAgent: string;
  readonly devicePixelRatio: number;
  readonly viewport: InputTrace["viewport"];
  readonly deviceName: string;
}

export function buildTrace(
  profile: DeviceProfile,
  gestures: readonly TraceGesture[],
  environment: RecordingEnvironment,
): InputTrace {
  const { os, browser } = describeAgent(environment.userAgent);
  const name = environment.deviceName.trim();
  return {
    schema: 1,
    origin: "recorded",
    device: profile.device,
    label: `${profile.title}${name === "" ? "" : ` (${name})`} in ${browser} on ${os}`,
    os,
    browser,
    devicePixelRatio: environment.devicePixelRatio,
    viewport: environment.viewport,
    userAgent: environment.userAgent,
    gestures,
  };
}

export function traceFileName(trace: InputTrace): string {
  const slug = `${trace.device}-${trace.os}-${trace.browser}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return `${slug}.recorded.json`;
}

export function traceFileBody(trace: InputTrace): string {
  return `${JSON.stringify(trace, null, 2)}\n`;
}
