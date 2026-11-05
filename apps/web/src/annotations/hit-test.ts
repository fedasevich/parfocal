import type { Point } from "../measure/ruler-maths.ts";
import { type AnnotationDocument, isShapeHidden, isShapeLocked } from "./document.ts";
import {
  at,
  type Extent,
  isClosedKind,
  outlineOf,
  ringCount,
  ringOf,
  type Shape,
} from "./shapes.ts";

export interface SegmentProjection {
  readonly point: Point;
  readonly distance: number;
}

export function projectOnSegment(p: Point, a: Point, b: Point): SegmentProjection {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  const point = { x: a.x + dx * t, y: a.y + dy * t };
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

export function pointInRing(p: Point, ring: Float32Array): boolean {
  const count = ring.length >> 1;
  let inside = false;
  for (let i = 0, j = count - 1; i < count; j = i++) {
    const xi = at(ring, i * 2);
    const yi = at(ring, i * 2 + 1);
    const xj = at(ring, j * 2);
    const yj = at(ring, j * 2 + 1);
    if (yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function distanceToPolyline(p: Point, ring: Float32Array, closed: boolean): number {
  const count = ring.length >> 1;
  if (count === 0) return Number.POSITIVE_INFINITY;
  if (count === 1) return Math.hypot(p.x - at(ring, 0), p.y - at(ring, 1));
  let best = Number.POSITIVE_INFINITY;
  const last = closed ? count : count - 1;
  for (let i = 0; i < last; i++) {
    const next = (i + 1) % count;
    const a = { x: at(ring, i * 2), y: at(ring, i * 2 + 1) };
    const b = { x: at(ring, next * 2), y: at(ring, next * 2 + 1) };
    best = Math.min(best, projectOnSegment(p, a, b).distance);
  }
  return best;
}

export function extentsIntersect(a: Extent, b: Extent): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function extentOfCorners(a: Point, b: Point): Extent {
  return [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];
}

function ringsOf(shape: Shape): Float32Array[] {
  if (shape.kind === "brush") {
    return Array.from({ length: ringCount(shape) }, (_, index) => ringOf(shape, index));
  }
  return [outlineOf(shape)];
}

export function distanceToOutline(shape: Shape, p: Point): number {
  const closed = isClosedKind(shape.kind);
  return Math.min(...ringsOf(shape).map((ring) => distanceToPolyline(p, ring, closed)));
}

export function isInsideFill(shape: Shape, p: Point): boolean {
  if (!isClosedKind(shape.kind)) return false;
  return ringsOf(shape).some((ring) => pointInRing(p, ring));
}

export function isSelectable(doc: AnnotationDocument, shape: Shape): boolean {
  return !isShapeHidden(doc, shape) && !isShapeLocked(doc, shape);
}

const markKinds: ReadonlySet<string> = new Set(["point", "text"]);

export function pickShape(
  doc: AnnotationDocument,
  p: Point,
  tolerance: number,
  markTolerance = tolerance,
): Shape | null {
  const stack = [...doc.shapes.values()].reverse().filter((shape) => isSelectable(doc, shape));
  const reach = (shape: Shape) => (markKinds.has(shape.kind) ? markTolerance : tolerance);
  const onOutline = stack.find((shape) => distanceToOutline(shape, p) <= reach(shape));
  if (onOutline) return onOutline;
  return stack.find((shape) => isInsideFill(shape, p)) ?? null;
}

export function shapesInExtent(doc: AnnotationDocument, area: Extent): Shape[] {
  return [...doc.shapes.values()].filter(
    (shape) => isSelectable(doc, shape) && extentsIntersect(shape.bounds, area),
  );
}
