export type StageAction = "draw" | "pan" | "erase" | "ignore";

export type StageInput = {
  readonly pointerType: string;
  readonly button: number;
  readonly buttons: number;
};

const barrelButtons = 2;
const eraserButtons = 32;
const eraserButton = 5;
const barrelButton = 2;

export function isPenErase(input: StageInput): boolean {
  if (input.pointerType !== "pen") return false;
  return (
    (input.buttons & eraserButtons) !== 0 ||
    (input.buttons & barrelButtons) !== 0 ||
    input.button === eraserButton ||
    input.button === barrelButton
  );
}

export function stageAction(input: StageInput): StageAction {
  if (input.pointerType === "touch") return "pan";
  if (input.pointerType === "pen") {
    if (isPenErase(input)) return "erase";
    return input.button === 0 ? "draw" : "ignore";
  }
  return input.button === 0 ? "draw" : "ignore";
}

export const fingerPans = (input: Pick<StageInput, "pointerType">): boolean =>
  input.pointerType === "touch";

export type PointerStepType =
  | "pointerdown"
  | "pointermove"
  | "pointerup"
  | "pointercancel"
  | "lostpointercapture";

export type FingerSelectStep = "ignore" | "tap-only" | "full";

export function fingerSelectStep(pointerType: string, type: PointerStepType): FingerSelectStep {
  if (pointerType !== "touch") return "full";
  if (type === "pointerdown" || type === "pointerup" || type === "pointercancel") return "tap-only";
  return "ignore";
}

export const penDoubleTapMs = 350;
export const penDoubleTapSlopPx = 24;

export type PenTap = { readonly at: number; readonly x: number; readonly y: number };

export type PenDoubleTap = {
  readonly tap: (tap: PenTap) => boolean;
  readonly reset: () => void;
};

export function createPenDoubleTap(
  windowMs: number = penDoubleTapMs,
  slopPx: number = penDoubleTapSlopPx,
): PenDoubleTap {
  let previous: PenTap | null = null;
  return {
    tap: (tap) => {
      const last = previous;
      if (
        last !== null &&
        tap.at - last.at >= 0 &&
        tap.at - last.at <= windowMs &&
        Math.hypot(tap.x - last.x, tap.y - last.y) <= slopPx
      ) {
        previous = null;
        return true;
      }
      previous = tap;
      return false;
    },
    reset: () => {
      previous = null;
    },
  };
}

export type ToolHistory<T> = {
  readonly current: () => T;
  readonly previous: () => T | null;
  readonly select: (tool: T) => void;
  readonly swap: () => T;
};

export function createToolHistory<T>(initial: T): ToolHistory<T> {
  let current = initial;
  let previous: T | null = null;
  return {
    current: () => current,
    previous: () => previous,
    select: (tool) => {
      if (tool === current) return;
      previous = current;
      current = tool;
    },
    swap: () => {
      if (previous === null) return current;
      const next = previous;
      previous = current;
      current = next;
      return current;
    },
  };
}
