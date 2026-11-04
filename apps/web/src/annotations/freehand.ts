import type { Point } from "./polygon-draft.ts";

export const simplifyToleranceScreenPixels = 1.5;
export const minimumStrokeScreenPixels = 6;
export const minimumStrokeVertices = 3;

type Coalescing = { getCoalescedEvents?: () => PointerEvent[] };

export function strokeSamples(event: PointerEvent): readonly PointerEvent[] {
  const coalesced = (event as Coalescing).getCoalescedEvents?.() ?? [];
  return coalesced.length > 0 ? coalesced : [event];
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function simplifyPath(points: readonly Point[], tolerance: number): Point[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  for (let range = stack.pop(); range !== undefined; range = stack.pop()) {
    const [from, to] = range;
    const a = points[from];
    const b = points[to];
    if (a === undefined || b === undefined) continue;
    let worst = -1;
    let worstDistance = tolerance;
    for (let index = from + 1; index < to; index += 1) {
      const p = points[index];
      if (p === undefined) continue;
      const distance = distanceToSegment(p, a, b);
      if (distance > worstDistance) {
        worstDistance = distance;
        worst = index;
      }
    }
    if (worst < 0) continue;
    keep[worst] = 1;
    stack.push([from, worst], [worst, to]);
  }
  return points.filter((_, index) => keep[index] === 1);
}

export function finishStroke(stroke: readonly Point[], scale: number): Float32Array | null {
  const first = stroke[0];
  if (first === undefined) return null;
  const extent = stroke.reduce(
    (widest, p) => Math.max(widest, Math.hypot(p.x - first.x, p.y - first.y)),
    0,
  );
  if (extent * scale < minimumStrokeScreenPixels) return null;
  const simplified = simplifyPath(stroke, simplifyToleranceScreenPixels / scale);
  if (simplified.length < minimumStrokeVertices) return null;
  return Float32Array.from(simplified.flatMap((p) => [p.x, p.y]));
}
