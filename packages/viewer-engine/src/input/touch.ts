import type { InputPoint } from "./gestures.ts";

export interface TouchTuning {
  readonly tapSlopPx: number;
  readonly tapMaxMs: number;
  readonly doubleTapWindowMs: number;
  readonly doubleTapSlopPx: number;
  readonly doubleTapMagnification: number;
  readonly syntheticDoubleClickGuardMs: number;
}

export const touchTuning: TouchTuning = {
  tapSlopPx: 10,
  tapMaxMs: 300,
  doubleTapWindowMs: 350,
  doubleTapSlopPx: 40,
  doubleTapMagnification: 40,
  syntheticDoubleClickGuardMs: 500,
};

export type DoubleTap =
  | { readonly kind: "magnify"; readonly at: InputPoint }
  | { readonly kind: "fit" };

export interface TapRecognizer {
  readonly down: (pointerId: number, at: InputPoint, timeMs: number) => void;
  readonly move: (pointerId: number, at: InputPoint) => void;
  readonly up: (timeMs: number, remaining: number) => DoubleTap | null;
  readonly reset: () => void;
}

interface Candidate {
  readonly startMs: number;
  readonly origins: Map<number, InputPoint>;
  moved: boolean;
}

interface Tap {
  readonly endMs: number;
  readonly fingers: number;
  readonly centre: InputPoint;
}

function distance(a: InputPoint, b: InputPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

function centreOf(points: Iterable<InputPoint>): InputPoint {
  const all = [...points];
  const count = Math.max(1, all.length);
  return {
    clientX: all.reduce((sum, p) => sum + p.clientX, 0) / count,
    clientY: all.reduce((sum, p) => sum + p.clientY, 0) / count,
  };
}

export function createTapRecognizer(tuning: TouchTuning = touchTuning): TapRecognizer {
  let candidate: Candidate | null = null;
  let previous: Tap | null = null;

  const down = (pointerId: number, at: InputPoint, timeMs: number) => {
    if (candidate === null) {
      candidate = { startMs: timeMs, origins: new Map([[pointerId, at]]), moved: false };
      return;
    }
    const lateOrCrowded =
      candidate.origins.size >= 2 || timeMs - candidate.startMs > tuning.tapMaxMs;
    if (lateOrCrowded) candidate.moved = true;
    else candidate.origins.set(pointerId, at);
  };

  const move = (pointerId: number, at: InputPoint) => {
    const origin = candidate?.origins.get(pointerId);
    if (candidate && origin && distance(origin, at) > tuning.tapSlopPx) candidate.moved = true;
  };

  const up = (timeMs: number, remaining: number): DoubleTap | null => {
    const finished = candidate;
    if (finished === null || remaining > 0) return null;
    candidate = null;
    const quick = !finished.moved && timeMs - finished.startMs <= tuning.tapMaxMs;
    if (!quick) {
      previous = null;
      return null;
    }
    const tap: Tap = {
      endMs: timeMs,
      fingers: finished.origins.size,
      centre: centreOf(finished.origins.values()),
    };
    const first = previous;
    const repeated =
      first !== null &&
      first.fingers === tap.fingers &&
      finished.startMs - first.endMs <= tuning.doubleTapWindowMs &&
      distance(first.centre, tap.centre) <= tuning.doubleTapSlopPx;
    previous = repeated ? null : tap;
    if (!repeated) return null;
    return tap.fingers === 1 ? { kind: "magnify", at: tap.centre } : { kind: "fit" };
  };

  const reset = () => {
    candidate = null;
    previous = null;
  };

  return { down, move, up, reset };
}
