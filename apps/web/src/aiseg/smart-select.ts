import {
  type BestMask,
  fittedLogits,
  modelToSlide,
  type SamBox,
  type SamFrame,
  type SamPlanePoint,
  type SamPrompt,
  slideToModel,
} from "@parfocal/viewer-engine";
import { type Ring, ringArea, simplifyRing, traceContours } from "./contour-trace.ts";

export interface SmartPoint extends SamPlanePoint {
  readonly positive: boolean;
}

export interface SmartBox {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface SmartPrompts {
  readonly points: readonly SmartPoint[];
  readonly box: SmartBox | null;
}

export const emptyPrompts: SmartPrompts = { points: [], box: null };

export const boxSlopScreenPixels = 4;

export const ringTolerance = 0.4;

export type SmartGesture =
  | { readonly kind: "point"; readonly positive: boolean; readonly extend: boolean }
  | { readonly kind: "box" };

export interface PressFacts {
  readonly button: number;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly movedScreenPixels: number;
}

export function classifyPress(press: PressFacts): SmartGesture | null {
  if (press.button === 2) return { kind: "point", positive: false, extend: true };
  if (press.button !== 0) return null;
  if (press.movedScreenPixels > boxSlopScreenPixels) return { kind: "box" };
  if (press.altKey) return { kind: "point", positive: false, extend: true };
  return { kind: "point", positive: true, extend: press.shiftKey };
}

export function withPoint(prompts: SmartPrompts, point: SmartPoint): SmartPrompts {
  return { ...prompts, points: [...prompts.points, point] };
}

export function withBox(prompts: SmartPrompts, box: SmartBox): SmartPrompts {
  return { ...prompts, box };
}

export function withoutLast(prompts: SmartPrompts): SmartPrompts {
  if (prompts.points.length > 0) return { ...prompts, points: prompts.points.slice(0, -1) };
  return { ...prompts, box: null };
}

export function isEmpty(prompts: SmartPrompts): boolean {
  return prompts.points.length === 0 && prompts.box === null;
}

export function normalisedBox(from: SamPlanePoint, to: SamPlanePoint): SmartBox {
  return {
    x0: Math.min(from.x, to.x),
    y0: Math.min(from.y, to.y),
    x1: Math.max(from.x, to.x),
    y1: Math.max(from.y, to.y),
  };
}

export function anchorOf(prompts: SmartPrompts): SamPlanePoint | null {
  const positive = prompts.points.find((point) => point.positive);
  if (positive !== undefined) return positive;
  if (prompts.box !== null) {
    return { x: (prompts.box.x0 + prompts.box.x1) / 2, y: (prompts.box.y0 + prompts.box.y1) / 2 };
  }
  return null;
}

export function modelPrompt(
  frame: SamFrame,
  prompts: SmartPrompts,
  previousLogits: Float32Array | null,
): SamPrompt {
  const points = prompts.points.map((point) => ({
    ...slideToModel(frame, point),
    positive: point.positive,
  }));
  let box: SamBox | null = null;
  if (prompts.box !== null) {
    const low = slideToModel(frame, { x: prompts.box.x0, y: prompts.box.y0 });
    const high = slideToModel(frame, { x: prompts.box.x1, y: prompts.box.y1 });
    box = { x0: low.x, y0: low.y, x1: high.x, y1: high.y };
  }
  return { points, box, previousLogits };
}

function ringHolds(ring: Ring, point: SamPlanePoint): boolean {
  let inside = false;
  const count = ring.length / 2;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = ring[i * 2] ?? 0;
    const yi = ring[i * 2 + 1] ?? 0;
    const xj = ring[j * 2] ?? 0;
    const yj = ring[j * 2 + 1] ?? 0;
    if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function chooseRing(rings: readonly Ring[], seed: SamPlanePoint | null): Ring | null {
  if (rings.length === 0) return null;
  if (seed !== null) {
    let best: Ring | null = null;
    let bestArea = Infinity;
    for (const ring of rings) {
      const area = ringArea(ring);
      if (area < bestArea && ringHolds(ring, seed)) {
        best = ring;
        bestArea = area;
      }
    }
    if (best !== null) return best;
  }
  return rings[0] ?? null;
}

export function maskToSlideRing(
  best: BestMask,
  frame: SamFrame,
  prompts: SmartPrompts,
): Float32Array | null {
  const field = fittedLogits(best.logits, frame);
  const rings = traceContours(field, frame.fittedWidth, frame.fittedHeight, 0);
  const anchor = anchorOf(prompts);
  const seed = anchor === null ? null : slideToModel(frame, anchor);
  const chosen = chooseRing(rings, seed);
  if (chosen === null) return null;
  const simple = simplifyRing(chosen, ringTolerance);
  const slide = new Float32Array(simple.length);
  for (let i = 0; i < simple.length; i += 2) {
    const where = modelToSlide(frame, { x: simple[i] ?? 0, y: simple[i + 1] ?? 0 });
    slide[i] = where.x;
    slide[i + 1] = where.y;
  }
  return slide;
}
