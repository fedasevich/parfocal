import { classifyWheel, freshWheelClassifier, type WheelClassifier } from "@parfocal/viewer-engine";
import { mapInput, type RawInput } from "../../devices/intents.ts";
import type { InputTrace, TraceGesture } from "./trace-format.ts";

interface WheelStep {
  readonly type: "wheel";
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaMode: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly expect: "pan" | "zoom";
  readonly panSign?: readonly [number, number];
  readonly zoomSign?: number;
  readonly animate?: boolean;
}

interface PointerStep {
  readonly type: "pointer";
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly pointerType: string;
  readonly expect: "negativePoint" | "none";
}

interface PinchStep {
  readonly type: "safariPinch";
  readonly previousScale: number;
  readonly scale: number;
  readonly expect: "zoom" | "none";
}

export interface TrackpadFixture {
  readonly origin: "recorded";
  readonly todo: string;
  readonly label: string;
  readonly wheelDevice: "trackpad";
  readonly basis: string;
  readonly steps: readonly (WheelStep | PointerStep | PinchStep)[];
}

const restingScale = 1;

function wheelSteps(gesture: TraceGesture, start: WheelClassifier) {
  let state = start;
  const steps: WheelStep[] = [];
  for (const event of gesture.events) {
    if (event.type !== "wheel") continue;
    state = classifyWheel(state, event);
    const raw: RawInput = { kind: "wheel", mode: "auto", wheelDevice: state.device, input: event };
    const [intent] = mapInput(state.device, "annotate", raw);
    if (intent === undefined) continue;
    const base = {
      type: "wheel" as const,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    };
    if (intent.kind === "pan") {
      steps.push({
        ...base,
        expect: "pan",
        panSign: [Math.sign(intent.dx), Math.sign(intent.dy)],
      });
    }
    if (intent.kind === "zoom") {
      steps.push({
        ...base,
        expect: "zoom",
        zoomSign: Math.sign(intent.octaves),
        animate: intent.animate,
      });
    }
  }
  return { steps, state };
}

function clickSteps(gesture: TraceGesture): PointerStep[] {
  return gesture.events.flatMap((event) => {
    if (event.type !== "pointerdown") return [];
    const raw: RawInput = {
      kind: "pointer",
      button: event.button,
      ctrlKey: event.ctrlKey,
      pointerType: event.pointerType,
    };
    const expect: PointerStep["expect"] =
      mapInput("trackpad", "annotate", raw).length > 0 ? "negativePoint" : "none";
    return [
      {
        type: "pointer" as const,
        button: event.button,
        ctrlKey: event.ctrlKey,
        pointerType: event.pointerType,
        expect,
      },
    ];
  });
}

function pinchSteps(gesture: TraceGesture): PinchStep[] {
  let previousScale = restingScale;
  const steps: PinchStep[] = [];
  for (const event of gesture.gestureEvents ?? []) {
    if (event.type === "gesturestart") previousScale = restingScale;
    if (event.type !== "gesturechange") continue;
    const raw: RawInput = { kind: "safariPinch", previousScale, scale: event.scale };
    const expect: PinchStep["expect"] =
      mapInput("trackpad", "annotate", raw).length > 0 ? "zoom" : "none";
    steps.push({ type: "safariPinch", previousScale, scale: event.scale, expect });
    previousScale = event.scale;
  }
  return steps;
}

export function fixtureFromTrace(trace: InputTrace): TrackpadFixture {
  let state = freshWheelClassifier;
  const steps: TrackpadFixture["steps"][number][] = [];
  for (const gesture of trace.gestures) {
    const wheel = wheelSteps(gesture, state);
    state = wheel.state;
    steps.push(...wheel.steps);
    if (gesture.gesture === "two-finger-click") steps.push(...clickSteps(gesture));
    steps.push(...pinchSteps(gesture));
  }
  return {
    origin: "recorded",
    todo: "TODO: expectations are what the current code produces for this recording. Read them once, then keep the file as the regression trace.",
    label: trace.label,
    wheelDevice: "trackpad",
    basis: `Recorded on ${trace.os} in ${trace.browser} with ${trace.userAgent}`,
    steps,
  };
}

export function fixtureFileName(trace: InputTrace): string {
  const slug = `${trace.os}-${trace.browser}-${trace.device}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-");
  return `${slug}.recorded.json`;
}
