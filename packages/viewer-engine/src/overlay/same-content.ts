import { isLabelOverlay, isPinOverlay, isRasterOverlay } from "./overlay.ts";
import type { OverlayDescription, VectorOverlay } from "./types.ts";

type Typed = ArrayBufferView & ArrayLike<number>;

function isTyped(value: unknown): value is Typed {
  return ArrayBuffer.isView(value) && !(value instanceof DataView);
}

function sameTyped(a: Typed, b: Typed): boolean {
  if (a === b || a.constructor !== b.constructor || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index++) if (a[index] !== b[index]) return false;
  return true;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (isTyped(a) || isTyped(b)) return isTyped(a) && isTyped(b) && sameTyped(a, b);
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const scalarsFirst = [...keysA].sort(
    (x, y) => Number(typeof left[x] === "object") - Number(typeof left[y] === "object"),
  );
  return scalarsFirst.every((key) => key in right && sameValue(left[key], right[key]));
}

function isVector(overlay: OverlayDescription): overlay is VectorOverlay {
  return !isRasterOverlay(overlay) && !isPinOverlay(overlay) && !isLabelOverlay(overlay);
}

export function sameVectorContent(a: OverlayDescription, b: OverlayDescription): boolean {
  if (a === b) return true;
  return isVector(a) && isVector(b) && sameValue(a, b);
}
